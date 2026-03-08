"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { createTempDir, ensureTasksDir, removeTempDir } = require("../setup");

const origCwd = process.cwd();

describe("server API", () => {
  let tmpDir;
  let app;

  before(() => {
    tmpDir = createTempDir("api-test-");
    ensureTasksDir(tmpDir);
    process.chdir(tmpDir);
    delete require.cache[require.resolve("../../src/tasks/db")];
    delete require.cache[require.resolve("../../src/tasks/storage")];
    delete require.cache[require.resolve("../../src/tasks/taskLog")];
    delete require.cache[require.resolve("../../src/tasks/repositories")];
    delete require.cache[require.resolve("../../src/tasks/taskService")];
    delete require.cache[require.resolve("../../src/tasks/taskServiceAsync")];
    delete require.cache[require.resolve("../../src/tasks/compositionRoot")];
    delete require.cache[require.resolve("../../src/tasks/index")];
    delete require.cache[require.resolve("../../src/server/index")];
    const server = require("../../src/server/index");
    app = server.app;
  });

  after(() => {
    process.chdir(origCwd);
    removeTempDir(tmpDir);
  });

  it("GET /api/tasks returns array", async () => {
    const res = await request(app).get("/api/tasks");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it("POST /api/tasks creates task and returns 201", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .send({ title: "API Task", body: "Body", status: "open" });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.title, "API Task");
    assert.strictEqual(res.body.body, "Body");
    assert.ok(res.body.id);
  });

  it("POST /api/tasks without title returns 400", async () => {
    const res = await request(app).post("/api/tasks").send({ body: "x" });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it("GET /api/tasks/:id returns task or 404", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Get me" });
    const id = create.body.id;
    const res = await request(app).get(`/api/tasks/${id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, id);
    const notFound = await request(app).get("/api/tasks/99999");
    assert.strictEqual(notFound.status, 404);
  });

  it("POST/PUT/GET task with context stores and returns context", async () => {
    const create = await request(app)
      .post("/api/tasks")
      .send({
        title: "Task with context",
        body: "Do something",
        context: [{ type: "file", path: "src/foo.js" }, { type: "git", scope: "working" }],
      });
    assert.strictEqual(create.status, 201);
    assert.ok(Array.isArray(create.body.context));
    assert.strictEqual(create.body.context.length, 2);
    assert.strictEqual(create.body.context[0].type, "file");
    assert.strictEqual(create.body.context[0].path, "src/foo.js");
    const get = await request(app).get(`/api/tasks/${create.body.id}`);
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body.context.length, 2);
    const put = await request(app)
      .put(`/api/tasks/${create.body.id}`)
      .send({ context: [{ type: "folder", path: "lib" }] });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.context.length, 1);
    assert.strictEqual(put.body.context[0].type, "folder");
  });

  it("PUT /api/tasks/:id updates task", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Put me" });
    const id = create.body.id;
    const res = await request(app).put(`/api/tasks/${id}`).send({ title: "Updated", status: "done" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, "Updated");
    assert.strictEqual(res.body.status, "done");
  });

  it("DELETE /api/tasks/:id returns 204", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Delete me" });
    const id = create.body.id;
    const res = await request(app).delete(`/api/tasks/${id}`);
    assert.strictEqual(res.status, 204);
    const get = await request(app).get(`/api/tasks/${id}`);
    assert.strictEqual(get.status, 404);
  });

  it("POST /api/tasks/:id/queue sets status queued", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Queue me" });
    const id = create.body.id;
    const res = await request(app).post(`/api/tasks/${id}/queue`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "queued");
  });

  it("GET /api/tasks/:id/log returns array", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Log me" });
    const id = create.body.id;
    const res = await request(app).get(`/api/tasks/${id}/log`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it("GET /api/tasks/:id/log?last=N returns at most N events", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Log last" });
    const id = create.body.id;
    const tasksMod = require("../../src/tasks/index");
    await tasksMod.appendEvent(id, { type: "started", text: "A" });
    await tasksMod.appendEvent(id, { type: "chunk", text: "B" });
    await tasksMod.appendEvent(id, { type: "chunk", text: "C" });
    const res = await request(app).get(`/api/tasks/${id}/log?last=2`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    assert.strictEqual(res.body[0].text, "B");
    assert.strictEqual(res.body[1].text, "C");
  });

  it("GET /api/tasks/:id/comments returns array", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Comments me" });
    const id = create.body.id;
    const res = await request(app).get(`/api/tasks/${id}/comments`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it("POST /api/tasks/:id/comments creates comment", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "Comment task" });
    const id = create.body.id;
    const res = await request(app)
      .post(`/api/tasks/${id}/comments`)
      .send({ content: "Hello", author: "user" });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.content, "Hello");
    assert.strictEqual(res.body.author, "user");
  });

  it("POST /api/tasks/:id/comments without content returns 400", async () => {
    const create = await request(app).post("/api/tasks").send({ title: "No content" });
    const id = create.body.id;
    const res = await request(app).post(`/api/tasks/${id}/comments`).send({});
    assert.strictEqual(res.status, 400);
  });

  it("GET /api/projects returns array with default project", async () => {
    const res = await request(app).get("/api/projects");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.some((p) => p.id === 1 && p.name === "Default"));
  });

  it("POST /api/projects creates project and GET returns it", async () => {
    const res = await request(app)
      .post("/api/projects")
      .send({ name: "My Repo", slug: "my-repo" });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, "My Repo");
    assert.ok(res.body.id);
    const get = await request(app).get(`/api/projects/${res.body.id}`);
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body.name, "My Repo");
  });

  it("GET /api/worker/status returns object", async () => {
    const res = await request(app).get("/api/worker/status");
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body === "object");
    assert.ok("alive" in res.body);
  });

  it("GET /api/repo/files returns entries or 500 when not in git repo", async () => {
    const res = await request(app).get("/api/repo/files");
    if (res.status === 200) {
      assert.ok(Array.isArray(res.body.entries));
      assert.ok(typeof res.body.path === "string");
    } else {
      assert.strictEqual(res.status, 500);
      assert.ok(res.body.error);
    }
  });

  it("POST /api/internal/broadcast with event returns 204", async () => {
    const res = await request(app)
      .post("/api/internal/broadcast")
      .send({ event: "test", data: {} });
    assert.strictEqual(res.status, 204);
  });

  it("POST /api/internal/broadcast without event returns 400", async () => {
    const res = await request(app)
      .post("/api/internal/broadcast")
      .send({ data: {} });
    assert.strictEqual(res.status, 400);
  });
});
