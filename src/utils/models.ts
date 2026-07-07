type RawBlogInfo = {
    id: number,
    slug: string,
    title?: string,
    cover?: string,
    desc?: string,
    emoji?: string,
    section: string,
    tags?: string,
    created_time: string,
    updated_time: string,
    completed: boolean,
};

type BlogInfo = {
    id: number,
    slug: string,
    title?: string,
    cover?: string,
    desc?: string,
    emoji?: string,
    section: string,
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
        cover: raw.cover,
        desc: raw.desc,
        emoji: raw.emoji,
        section: raw.section,
        tags: raw.tags ? raw.tags.trim().split(",") : [],
        createdTime: raw.created_time,
        updatedTime: raw.updated_time,
        completed: raw.completed,
    };
}

export type { RawBlogInfo, BlogInfo };
export { standardBlogInfo };