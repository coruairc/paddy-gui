import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ControllerRuntime } from "./runtime.ts";

function makeChild(pid = 4242) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

function tempStateFile(): string {
  const root = mkdtempSync(join(tmpdir(), "ocw-rt-"));
  return join(root, "state.json");
}

test("constructor accepts string state file and options object", () => {
  const file = tempStateFile();
  const a = new ControllerRuntime(file);
  assert.equal(a.stateFile, file);
  const b = new ControllerRuntime({ stateFile: file });
  assert.equal(b.stateFile, file);
  const c = new ControllerRuntime();
  assert.ok(c.stateFile.length > 0);
});

test("seam injection uses custom sleep and kill", async () => {
  const file = tempStateFile();
  const sleepCalls: number[] = [];
  const killCalls: Array<[number, string]> = [];
  const child = makeChild(4242);
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    kill: (pid, signal) => {
      killCalls.push([pid, String(signal)]);
    },
    spawn: () => child as any,
  });
  (runtime as any).child = child;
  (runtime as any).ownedPassword = "pw";
  runtime.state.ownedServerPassword = "pw";
  runtime.persist();
  await runtime.disconnect();
  assert.ok(sleepCalls.length > 0, "sleep seam invoked");
  assert.ok(killCalls.some((c) => c[0] === -4242 && c[1] === "SIGTERM"), "kill seam invoked with group SIGTERM");
  assert.equal(runtime.state.ownedServerPassword, "");
});

test("disconnect kills process group SIGTERM then SIGKILL if not exited", async () => {
  const file = tempStateFile();
  const killCalls: Array<[number, string]> = [];
  const child = makeChild(4242);
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async () => {},
    kill: (pid, signal) => {
      killCalls.push([pid, String(signal)]);
    },
    spawn: () => child as any,
  });
  (runtime as any).child = child;
  await runtime.disconnect();
  assert.deepEqual(killCalls[0], [-4242, "SIGTERM"]);
  assert.ok(killCalls.some((c) => c[0] === -4242 && c[1] === "SIGKILL"), "SIGKILL escalation occurred");
});

test("disconnect clears ownedPassword and ownedServerPassword", async () => {
  const file = tempStateFile();
  const child = makeChild(4242);
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async () => {},
    kill: () => {},
    spawn: () => child as any,
  });
  runtime.state.ownedServerPassword = "owned-pw";
  runtime.state.connectionPassword = "conn-pw";
  (runtime as any).ownedPassword = "owned-pw";
  (runtime as any).child = child;
  runtime.persist();
  await runtime.disconnect();
  assert.equal((runtime as any).ownedPassword, "");
  assert.equal(runtime.state.ownedServerPassword, "");
  // persisted
  const { readState } = await import("./state.ts");
  const reloaded = readState(file);
  assert.equal(reloaded.ownedServerPassword, "");
});

test("exit handler guard: natural exit after disconnect does not clobber status", async () => {
  const file = tempStateFile();
  const child = makeChild(4242);
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async () => {},
    kill: () => {},
    spawn: () => child as any,
  });
  (runtime as any).child = child;
  await runtime.disconnect();
  // status disconnected
  assert.equal(runtime.status.connected, false);
  // emit natural exit; should not flip to "OpenCode exited"
  child.emit("exit", 0, null);
  assert.equal(runtime.status.connected, false);
  assert.notEqual(runtime.status.error, "OpenCode exited (0)");
});

test("spawn uses detached:true", async () => {
  const file = tempStateFile();
  const spawnCalls: any[] = [];
  const child = makeChild(7777);
  // make child never ready so connect resolves quickly-ish
  const runtime = new ControllerRuntime({
    stateFile: file,
    sleep: async () => {},
    kill: () => {},
    spawn: (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      return child as any;
    },
  });
  const prevBin = process.env.OPENCODE_BIN;
  const bin = join(tmpdir(), "fake-opencode-bin");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  process.env.OPENCODE_BIN = bin;
  try {
    await runtime.connect();
  } finally {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = prevBin;
    try {
      rmSync(bin, { force: true });
    } catch {
      /* ignore */
    }
  }
  assert.ok(spawnCalls.length > 0, "spawn invoked");
  assert.equal(spawnCalls[0].opts.detached, true, "detached true");
});

test("reset via api clears child", async () => {
  const { handleApi } = await import("./api.ts");
  const root = mkdtempSync(join(tmpdir(), "ocw-api-"));
  const project = join(root, "app");
  // ensure dir exists
  const { mkdirSync } = await import("node:fs");
  mkdirSync(project);
  const file = join(root, "state.json");
  const runtime = new ControllerRuntime(file);
  const { newId } = await import("./state.ts");
  const id = newId("prj");
  runtime.state.projects = [{ id, name: "App", path: project, createdAt: 1 }];
  runtime.state.activeProjectId = id;
  runtime.status = {
    installed: true,
    connected: true,
    healthy: true,
    startedByController: false,
    authRequired: false,
    controllerVersion: "0.2.0",
    version: "1.18.33",
  } as any;
  const child = makeChild(9999);
  const killCalls: Array<[number, string]> = [];
  (runtime as any).child = child;
  (runtime as any).killImpl = (pid: number, signal: any) => {
    killCalls.push([pid, String(signal)]);
  };
  (runtime as any).sleepImpl = async () => {};
  runtime.client = { disconnect: () => {} } as any;
  const req = new Request("http://127.0.0.1:8080/api/settings/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const result = await handleApi(runtime, req);
  assert.equal(result.status, 200);
  assert.ok(killCalls.some((c) => c[0] === -9999), "child killed on reset");
  assert.equal(runtime.state.ownedServerPassword, "");
});
