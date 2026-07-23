import { getBlog, initBlogSystem, postBlog, searchBlog } from "./src/components/Database/blogs";
import { uploadFile } from "./src/components/File/upload";
import { failJSON, successJSON, HttpError } from "./src/utils/request";

console.log("Service is now loading...");
await initBlogSystem();

const server = Bun.serve({
    port: 5000,
    routes: {
        "/api/ping": new Response("Pong!"),
        "/api/upload": {
            POST: async (req) => {
                try {
                    const url = await uploadFile(req);
                    return Response.json(successJSON({ url: url }), { status: 201 });
                } catch (e) {
                    const status = e instanceof HttpError ? e.status : 500;
                    const message = e instanceof HttpError
                        ? e.message
                        : `Internal server error: ${(e as Error).message}`;
                    return Response.json(failJSON(status, message), { status });
                }
            }
        },
        "/api/blog/list": {
            GET: async (req) => {
                const params = new URL(req.url).searchParams;
                const q = params.get("q") ?? undefined;
                const tag = params.get("tag") ?? undefined;
    
                return Response.json(successJSON({ items: searchBlog({ q, tag }) }));
            }
        },
        "/api/blog/:slug": {
            GET: async (req) => {
                const slug = req.params.slug;
                const blog = getBlog(slug);
                if (!blog) {
                    return Response.json(failJSON(404, `The blog [${slug}] does not exist.`), { status: 404 });
                }
                return Response.json(successJSON({ blog: blog }));
            },
            PUT: async (req) => {
                const slug = req.params.slug;
                try {
                    await postBlog(req, slug);
                    return Response.json(successJSON({}), { status: 201 });
                } catch (e) {
                    const status = e instanceof HttpError ? e.status : 500;
                    const message = e instanceof HttpError
                        ? e.message
                        : `Internal server error: ${(e as Error).message}`;
                    return Response.json(failJSON(status, message), { status });
                }
            }
        },
        "/api/blog": {
            POST: async (req) => {
                try {
                    await postBlog(req);
                    return Response.json(successJSON({}), { status: 201 });
                } catch (e) {
                    const status = e instanceof HttpError ? e.status : 500;
                    const message = e instanceof HttpError
                        ? e.message
                        : `Internal server error: ${(e as Error).message}`;
                    return Response.json(failJSON(status, message), { status });
                }
            }
        }
    },
    fetch(req) {
        return new Response("Route not found.", { status: 404 });
    }
});

console.log(`Done! Server is now on [${server.url}]!`);
