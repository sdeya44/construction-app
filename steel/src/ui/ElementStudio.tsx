import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { settingsOf } from './navIndex';
import { CardPartCtx, PropertiesPanel } from './PropertiesPanel';
import { WizardNavigation, WizardSection, type WzSec } from './wizard/Wizard';

/**
 * 1.64: אלמנט בודד (עמוד, קורה, פטה, פלטה…) — באותו חלון ובאותו מבנה כמו האשפים:
 *   כותרת + "השינויים יחולו על" → 1 מיקום במבנה · 2 גיאומטריה · 3 חתך ומחברים → שחזור / ביטול / אישור.
 * התוכן הוא כרטיס האלמנט הקיים, מחולק לקבוצות (CardPartCtx) — שום יכולת לא הוסרה.
 */
export function ElementStudio({ memberId }: { memberId: string }) {
  const d = useStore((s) => s.derived);
  const scope = useStore((s) => s.propScope ?? null);
  const m = d.byId.get(memberId);
  const [sec, setSec] = useState<WzSec>(scope === 'frame' ? 'loc' : 'conn');
  // "כל המסגרת" = גיאומטריית המסגרת (מיקום במבנה); שאר ההיקפים — החתך והמחברים
  useEffect(() => { if (scope === 'frame') setSec('loc'); else if (scope) setSec('conn'); }, [scope]);
  if (!m) return null;
  const fam = settingsOf(m.id, m.kind, m.purlin?.paramKey ?? (m.purlin?.side === 'R' ? 'right' : m.purlin ? 'left' : undefined));
  return (
    <div className="ks" data-testid="el-studio">
      <CardPartCtx.Provider value="top"><PropertiesPanel /></CardPartCtx.Provider>
      {scope && <>
        <WizardNavigation value={sec} onPick={setSec} subs={{ loc: fam ? fam[1] : 'הקבוצה והרכיב', geo: 'צורה · שרטוט החלק · מתקדם', conn: m.profile }} />
        <WizardSection id={sec}>
          {sec === 'loc' && fam && <button className="btn el-fam" data-testid="el-family" onClick={() => window.dispatchEvent(new CustomEvent('ksp-nav', { detail: fam[0] }))}>⚙ {fam[1]} — כל הרכיב ←</button>}
          <CardPartCtx.Provider value={sec}><PropertiesPanel /></CardPartCtx.Provider>
        </WizardSection>
      </>}
    </div>
  );
}
