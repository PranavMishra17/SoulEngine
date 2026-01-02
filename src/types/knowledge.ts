export interface KnowledgeCategory {
  id: string;
  description: string;
  depths: Record<number, string>;
}

export interface KnowledgeBase {
  categories: Record<string, KnowledgeCategory>;
}

export type KnowledgeAccess = Record<string, number>;

