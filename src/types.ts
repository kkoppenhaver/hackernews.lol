export type Comment = {
  id: string;
  by: string;
  age: string;
  points?: number;
  text: string;
  children?: Comment[];
};

export type Thread = {
  /** HN-style numeric id, present on responses from /api/simulate and /api/item. */
  id?: string;
  url: string;
  title: string;
  hostname?: string;
  by: string;
  age: string;
  points: number;
  comments: Comment[];
};
