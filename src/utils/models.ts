type RawBlogInfo = {
    id: number,
    slug: string,
    title: string,
    desc: string,
    emoji: string,
    tags: string,
    created_time: string,
    updated_time: string,
    completed: number,
    cover: string | null,
};

type BlogInfo = {
    id: number,
    slug: string,
    title: string,
    desc: string,
    emoji: string,
    tags: string[],
    createdTime: string,
    updatedTime: string,
    completed: boolean,
    cover: string | null,
};

function standardBlogInfo(raw: RawBlogInfo): BlogInfo {
    return {
        id: raw.id,
        slug: raw.slug,
        title: raw.title,
        desc: raw.desc,
        emoji: raw.emoji,
        tags: raw.tags ? raw.tags.trim().split(",") : [],
        createdTime: raw.created_time,
        updatedTime: raw.updated_time,
        completed: raw.completed === 1,
        cover: raw.cover,
    };
}

type ToyInfo = {
    id: number;
    slug: string;
    title: string;
    desc: string;
    cover: string | null;
};

type RawToyInfo = ToyInfo;

export type { RawBlogInfo, BlogInfo, RawToyInfo, ToyInfo };
export { standardBlogInfo };