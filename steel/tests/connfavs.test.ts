import { describe, expect, it } from 'vitest';
import { FAV_KEY, filterCands, loadFavs, saveFavs, toggleFav } from '../src/ui/connFavs';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const C = (id: string, title: string, desc = '', reason = ''): any => ({ id, title, desc, fit: { status: 'ok', reason } });

describe('FAV-01 מועדפים וחיפוש באשף החיבורים', () => {
  it('שמירה וטעינה; החלפת מצב; אחסון חסר/פגום לא מפיל', () => {
    const st = mem();
    expect(loadFavs(st).size).toBe(0);
    let f = toggleFav(new Set(), 'a'); f = toggleFav(f, 'b'); f = toggleFav(f, 'a');
    saveFavs(f, st);
    expect([...loadFavs(st)]).toEqual(['b']);
    st.setItem(FAV_KEY, '{bad json');
    expect(loadFavs(st).size).toBe(0);
    st.setItem(FAV_KEY, '{"x":1}');
    expect(loadFavs(st).size).toBe(0);
    expect(loadFavs(null).size).toBe(0);
    expect(() => saveFavs(new Set(['z']), null)).not.toThrow();
    expect(() => saveFavs(new Set(['z']), { getItem: () => null, setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });
  it('סינון: כל המילים, לא תלוי רישיות; מועדפים ראשונים; הסדר המקורי נשמר', () => {
    const l = [C('1', 'פלטת קצה', 'ארבעה ברגים'), C('2', 'זוויתן', 'שני ברגים', 'RHS'), C('3', 'לשונית', 'ברגים')];
    expect(filterCands(l, '', new Set()).map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(filterCands(l, '  ברגים ', new Set()).map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(filterCands(l, 'שני ברגים', new Set()).map((c) => c.id)).toEqual(['2']);
    expect(filterCands(l, 'rhs', new Set()).map((c) => c.id)).toEqual(['2']);
    expect(filterCands(l, 'xyz', new Set())).toEqual([]);
    expect(filterCands(l, '', new Set(['3'])).map((c) => c.id)).toEqual(['3', '1', '2']);
    expect(filterCands(l, 'ברגים', new Set(['2', '3'])).map((c) => c.id)).toEqual(['2', '3', '1']);
  });
});
