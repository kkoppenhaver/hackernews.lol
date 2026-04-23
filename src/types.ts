export type Comment = {
  id: string;
  by: string;
  age: string;
  points?: number;
  text: string;
  children?: Comment[];
};

export type Thread = {
  url: string;
  title: string;
  hostname?: string;
  by: string;
  age: string;
  points: number;
  comments: Comment[];
};
