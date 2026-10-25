/** Local same-origin weird/action photos (served by Vite from client/public/photos). */
export const PEOPLE_IMAGES: string[] = [
  '/photos/1.jpg',
  '/photos/2.jpg',
  '/photos/3.jpg',
  '/photos/4.jpg',
  '/photos/5.jpg',
  '/photos/6.jpg',
  '/photos/7.jpg',
  '/photos/8.jpg',
  '/photos/9.jpg',
  '/photos/10.jpg',
  '/photos/11.jpg',
  '/photos/12.jpg',
  '/photos/13.jpg',
  '/photos/14.jpg',
  '/photos/15.jpg',
  '/photos/16.jpg',
];

export function pickImage(usedIndexes: number[]): { url: string; index: number } {
  const available = PEOPLE_IMAGES.map((_, i) => i).filter((i) => !usedIndexes.includes(i));
  const pool = available.length > 0 ? available : PEOPLE_IMAGES.map((_, i) => i);
  const index = pool[Math.floor(Math.random() * pool.length)];
  return { url: PEOPLE_IMAGES[index], index };
}
