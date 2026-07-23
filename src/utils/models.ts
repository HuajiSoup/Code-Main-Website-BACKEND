type RawBlogInfo = {
    id: number,
    slug: string,
    title: string,
    desc: string,
    emoji: string,
    tags: string,
    created_time: string,
    updated_time: string,
    completed: boolean,
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
        completed: raw.completed,
    };
}

export type { RawBlogInfo, BlogInfo };
export { standardBlogInfo };