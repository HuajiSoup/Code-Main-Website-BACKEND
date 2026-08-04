import { Hono } from "hono";
import { failJSON, HttpError } from "./src/utils/request";
import { blogApp, initBlogSystem } from "./src/components/Database/blogs";
import { initUploadSystem, uploadApp } from "./src/components/File/upload";
import { initToySystem, toyApp } from "./src/components/Database/toys";

const EDIT_TOKEN = process.env.MYSELF_TOKEN ?? Math.random().toString();

console.log("Service is now initializing...");
await initBlogSystem();
await initToySystem();
await initUploadSystem();

console.log("Server is now loading...");
const app = new Hono();

app.on(["POST", "PUT", "DELETE"], "/api/*", async (c, next) => {
    const author = c.req.header("Authorization");
    if (!(author && author.startsWith("Bearer "))) {
        return c.json(failJSON(401, "Not authenticated."), 401);
    }

    const token = author.substring(7);
    if (token !== EDIT_TOKEN) {
        return c.json(failJSON(401, "Not authenticated."), 401);
    }

    await next();
});

app.notFound((c) => {
    return c.json(failJSON(404, "Route not found."), 404);
});

app.onError((e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    const message = (status === 500) ? `Server internal error: ${e.message}` : e.message;
    console.error(e);
    return c.json(failJSON(status, message), status);
});

app.route("/api/upload", uploadApp);
app.route("/api/blog", blogApp);
app.route("/api/toy", toyApp);

const server = Bun.serve({
    port: 5000,
    fetch: app.fetch
});

console.log(`Done! Server is now ready on [${server.url}]`);
