/** מזהים: Element ID נוצר באופן דטרמיניסטי מתפקיד האלמנט, ואינו Part Mark. */
let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1e6;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rnd}${counter.toString(36)}`;
}
