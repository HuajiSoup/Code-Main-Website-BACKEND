import { Hono } from "hono";
import { blogApp, initBlogSystem } from "./src/components/Database/blogs";
import { uploadApp } from "./src/components/File/upload";
import { failJSON, HttpError } from "./src/utils/request";

console.log("Service is now initializing...");
await initBlogSystem();

console.log("Server is now loading...");
const app = new Hono();

app.onError((e, c) => {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e.message;
    console.error(e);
    return c.json(failJSON(status, message), status);
})

app.route("/api/upload", uploadApp);
app.route("/api/blog", blogApp);

const server = Bun.serve({
    port: 5000,
    fetch: app.fetch
});

console.log(`Done! Server is now ready on [${server.url}]`);
