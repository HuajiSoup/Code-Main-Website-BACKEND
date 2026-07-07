import { searchBlog } from "./src/components/Database/blogs";
import { tokenized } from "./src/utils/tokenizer";

console.log("Server is now loading...");

const server = Bun.serve({
    port: 5000,
    routes: {
        "/api/ping": new Response("Pong!"),
        "/api/num": {
            POST: async (req) => {
                const post = (await req.json()) as { n: number };
                console.log(post.n);
                return Response.json({ res: post.n });
            }
        },
        "/api/tokenize": {
            POST: async (req) => {
                const post = (await req.json()) as { token: string };
                const token = post.token ?? "";
                return Response.json({ res: tokenized(token) });
            }
        },
        "/api/blogs": (req) => {
            const params = new URL(req.url).searchParams;

            const q = params.get("q") || "";
            return Response.json({ res: searchBlog(q) });
        }
    },
    fetch(req) {
        return new Response("Route not found.", { status: 404 });
    }
});

console.log(`Server is now on ${server.url} !`);
