"""ממיר את קובץ נתוני הפרופילים (CSV) לקטלוג מובנה: src/profiles/data/builtin.json.
שימוש: python3 scripts/import_profiles.py <profiles.csv>
יחידות פלט: mm, mm², mm⁴, mm³, ק"ג/מ'. משפחות היסטוריות / T / U מכופף — לא נכללות (אין צורה מתאימה בתוכנה)."""
import csv, json, re, sys

MAP = {'HEA': 'HEA', 'HEB': 'HEB', 'HEM': 'HEM', 'IPE': 'IPE', 'IPN': 'INP', 'UPN': 'UPN', 'UPE': 'UPE',
       'L_EQUAL': 'L', 'L_UNEQUAL': 'L', 'RHS': 'RHS', 'SHS': 'SHS', 'CHS': 'CHS', 'C': 'C', 'Z': 'Z', 'SIGMA': 'C'}

def f(x):
    try: return float(x) if x not in ('', None) else None
    except ValueError: return None

def g(v): return None if v is None else (int(v) if abs(v - round(v)) < 1e-9 else round(v, 4))

def name_of(r, fam):
    d = r['designation'].strip()
    h, b, t, c = f(r['h_mm']), f(r['b_mm']), f(r['t_mm']), f(r['lip_c_mm'])
    num = lambda v: g(v)
    if fam in ('HEA', 'HEB', 'HEM'): return fam + re.sub(r'\D', '', d)
    if fam in ('IPE', 'INP', 'UPN', 'UPE'): return fam + re.sub(r'[^\d.]', '', d.split(' ', 1)[1])
    if fam == 'L': return f"L{num(h)}x{num(t)}" if h == b else f"L{num(h)}x{num(b)}x{num(t)}"
    if fam == 'RHS': return f"RHS{num(h)}x{num(b)}x{num(t)}"
    if fam == 'SHS': return f"SHS{num(h)}x{num(t)}"
    if fam == 'CHS': return f"CHS{num(h)}x{num(t)}"
    if r['family'] == 'SIGMA' or 'x' not in d: return re.sub(r'\s+', '', d).upper().replace(',', '.')  # קוד יצרן
    return f"{fam}{num(h)}x{num(b)}x{num(c)}x{num(t)}" if c else f"{fam}{num(h)}x{num(b)}x{num(t)}"

rows = list(csv.DictReader(open(sys.argv[1], encoding='utf-8-sig')))
# עדיפות: נתונים מלאים ולא דורשים בדיקה; בצינורות — מכופף בקר (CF) לפני גמר חם (HF)
rows.sort(key=lambda r: (r['requires_review'] == 'True', r['core_data_complete'] != 'True', 'Hot finished' in r['manufacturing']))
out, seen = [], set()
for r in rows:
    fam = MAP.get(r['family'])
    if not fam: continue
    name = name_of(r, fam)
    if name in seen: continue
    seen.add(name)
    A, G = f(r['A_cm2']), f(r['G_kg_m'])
    if not A: continue
    e = {'n': name, 'f': fam, 'src': r['family'], 'd': r['designation'].strip(), 'm': 'CF' if 'Cold' in r['manufacturing'] else 'HF' if 'Hot finished' in r['manufacturing'] else 'HR',
         'h': g(f(r['h_mm'])), 'b': g(f(r['b_mm'])), 'b2': g(f(r['b2_mm'])), 'tw': g(f(r['tw_mm'])), 'tf': g(f(r['tf_mm'])), 't': g(f(r['t_mm'])),
         'r': g(f(r['r_internal_mm'])), 'ro': g(f(r['r_external_mm'])), 'c': g(f(r['lip_c_mm'])),
         'A': g(A * 100), 'G': g(G), 'Iy': g((f(r['Iy_cm4']) or 0) * 1e4) or None, 'Iz': g((f(r['Iz_cm4']) or 0) * 1e4) or None,
         'Wy': g((f(r['Wel_y_cm3']) or 0) * 1e3) or None, 'Wz': g((f(r['Wel_z_cm3']) or 0) * 1e3) or None,
         'iy': g((f(r['iy_cm']) or 0) * 10) or None, 'iz': g((f(r['iz_cm']) or 0) * 10) or None,
         'It': g((f(r['It_cm4']) or 0) * 1e4) or None, 'rv': r['requires_review'] == 'True' or r['core_data_complete'] != 'True'}
    out.append({k: v for k, v in e.items() if v not in (None, False, '')})
json.dump(out, open('src/profiles/data/builtin.json', 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(out), Counter(x['f'] for x in out), sum(1 for x in out if x.get('rv')))
