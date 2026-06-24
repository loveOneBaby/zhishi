export interface Entry {
  id: string;
  cat: string;
  title: string;
  py: string;
  tags: string[];
  summary: string;
  body: string;
  createdAt?: number;
  updatedAt?: number;
}

export type ThemeKey = 'mono' | 'ink' | 'paper';

export interface Theme {
  name: string;
  bg: string;
  fg: string;
  mut: string;
  bd: string;
  panel: string;
  sel: string;
  accent: string;
  font: string;
}
