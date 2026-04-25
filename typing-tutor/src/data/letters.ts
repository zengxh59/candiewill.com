export interface LetterLevel {
  name: string;
  keys: string[];
}

export const LETTER_LEVELS: LetterLevel[] = [
  {
    name: 'Home Row',
    keys: ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'],
  },
  {
    name: 'Top Row',
    keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  },
  {
    name: 'Bottom Row',
    keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  },
  {
    name: 'Full Keyboard',
    keys: 'abcdefghijklmnopqrstuvwxyz'.split(''),
  },
];
