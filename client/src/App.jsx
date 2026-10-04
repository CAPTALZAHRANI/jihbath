import { useState } from 'react';

const STATUS = {
  exact: 'ثابت ومطابق',
  variant: 'ثابت بلفظ مختلف',
  weak: 'لا يصح',
  not_found: 'لم يُعثر عليه',
  review: 'يحتاج مراجعة مختص',
  unavailable: 'تعذّر الوصول إلى المصدر',
};
const ORDER = ['exact', 'variant', 'weak', 'not_found', 'review', 'unavailable'];

const SAMPLE = `إن العبادة غاية الخلق، قال تعالى: ﴿وما خلقت الجن والإنس إلا ليعبدوني﴾. وقال رسول الله ﷺ: «إنما الأعمال بالنيات». ويُروى أن النبي ﷺ قال: اطلبوا العلم ولو بالصين. ومن العبارات المتداولة «حب الوطن من الإيمان». وقال النبي ﷺ: إن الله مع الصابرين.`;

function Diff({ ops }) {
  return ops.map((o, i) => {
    if (o.type === 'equal') return <span key={i}>{o.said.join(' ')} </span>;
    if (o.type === 'replace') return <span key={i}><del>{o.said.join(' ')}</del><ins>{o.source.join(' ')}</ins> </span>;
    if (o.type === 'added') return <span key={i}><del>{o.said.join(' ')}</del> </span>;
    return <span key={i}><ins className="missing">{o.source.join(' ')}</ins> </span>;
  });
}

// Arabic number agreement for "claim"
function claimsLabel(n) {
  if (n === 1) return 'ادعاء واحد';
  if (n === 2) return 'ادعاءان';
  if (n >= 3 && n <= 10) return `${n} ادعاءات`;
  return `${n} ادعاءً`;
}

const bare = (g) => String(g || '').replace(/^\[(.*)\]$/, '$1');

function ayahRef(ref) {
  return ref.from === ref.to ? `${ref.surahName}، الآية ${ref.from}` : `${ref.surahName}، الآيات ${ref.from}–${ref.to}`;
}

function QuranSource({ q, fragment }) {
  if (!q?.ref) return null;
  return (
    <div className="source">
      <p className="text">﴿{q.text}﴾</p>
      <span>{ayahRef(q.ref)}{fragment ? ' · المقتبس جزء من الآية' : ''} · مصحف حفص، الموسوعة القرآنية</span>
      {q.alternatives?.length > 0 && (
        <span> · وورد اللفظ أيضًا في: {q.alternatives.map(ayahRef).join('، ')}</span>
      )}
    </div>
  );
}

function HadithSource({ h }) {
  if (!h?.lead) {
    if (h?.status === 'unavailable') return <div className="source">الدرر السنية لا تستجيب الآن؛ أعد المحاولة بعد قليل.</div>;
    if (h?.status === 'not_found') return <div className="source">بُحث في الموسوعة الحديثية بالدرر السنية ({h.checked} نتيجة) دون نص مطابق.</div>;
    return null;
  }
  const { lead, groups = [], verdicts, alsoIn } = h;
  const others = groups.filter((g) => g.text !== lead.text || g.rawi !== lead.rawi);
  return (
    <div className="source">
      <p className="text">{lead.text}</p>
      <div className="verdict">
        حكم {lead.muhaddith}: <q>{bare(lead.grade)}</q>
      </div>
      <span>{lead.source}{lead.number ? `، ${lead.number}` : ''}{lead.rawi && lead.rawi !== '-' ? ` · الراوي: ${lead.rawi}` : ''} · الدرر السنية</span>
      {alsoIn && (
        <div>وأصله في {alsoIn.source}{alsoIn.number ? `، ${alsoIn.number}` : ''} بلفظ: {alsoIn.text}</div>
      )}
      {verdicts && (
        <div>أحكام الروايات المطابقة: {verdicts.strong} بالتصحيح، {verdicts.weak} بالتضعيف{verdicts.other ? `، ${verdicts.other} أخرى` : ''}</div>
      )}
      {others.length > 0 && (
        <details>
          <summary>روايات أخرى ({others.length})</summary>
          <ul>
            {others.map((g, i) => (
              <li key={i}>{g.rawi && g.rawi !== '-' ? `${g.rawi}: ` : ''}{g.muhaddith} في {g.source} — <q>{bare(g.grade)}</q></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Claim({ c }) {
  const ops = c.quran?.ops || c.hadith?.lead?.ops;
  const label = c.misattributed && c.status === 'variant' ? 'ثابت، ونسبته خاطئة'
    : c.merged ? 'آيتان دُمجتا في اقتباس واحد'
    : STATUS[c.status];
  return (
    <li className="claim" style={{ '--c': `var(--${c.status})` }}>
      <span className="badge"><span className="dot" style={{ background: 'var(--c)' }} />{label}</span>
      <span className="kind">{c.type === 'quran' ? 'نُقل آيةً' : c.type === 'hadith' ? 'نُقل حديثًا' : 'نص منقول'}</span>
      <p className="quote">{ops && c.status !== 'not_found' ? <Diff ops={ops} /> : c.text}</p>
      {c.note && <p className="note">{c.note}</p>}
      {c.kind === 'quran' ? <QuranSource q={c.quran} fragment={c.fragment} /> : <HadithSource h={c.hadith} />}
      {c.merged && <QuranSource q={c.merged.quran} fragment />}
    </li>
  );
}

export default function App() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  async function check() {
    setBusy(true); setError(''); setReport(null);
    try {
      const r = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setReport(data);
    } catch (e) {
      setError(`لم يكتمل التحقق: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="mast">
        <h1 className="wordmark">جِهْبَاذ<small>JIHBATH</small></h1>
        <p className="slogan">الأصلُ… بدقّةِ الجهابذة</p>
      </header>

      <p className="lede">الصق نصًّا دعويًّا، فيستخرج جِهْبَاذ ما فيه من آيات وأحاديث، ويطابق كل واحد منها كلمةً كلمة مع مصادره المعتمدة، وينقل حكم أهل العلم كما ورد.</p>

      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="الصق النص هنا…" aria-label="النص المراد التحقق منه" />
      <div className="actions">
        <button className="primary" onClick={check} disabled={busy || !text.trim()}>{busy ? 'جارٍ التحقق…' : 'تحقّق من النص'}</button>
        <button className="quiet" onClick={() => { setText(SAMPLE); setReport(null); }}>جرّب نصًّا نموذجيًّا</button>
        {busy && <span className="status-line">تُراجَع الأحاديث في الدرر السنية واحدًا واحدًا، وقد يستغرق ذلك ثواني.</span>}
      </div>
      {error && <p className="error">{error}</p>}

      {report && report.total === 0 && (
        <p className="empty">لا توجد في النص آيات أو أحاديث منقولة. ضع الآية بين ﴿ ﴾، أو الحديث بعد «قال رسول الله ﷺ».</p>
      )}

      {report && report.total > 0 && (
        <>
          <div className="summary" aria-label="ملخص">
            <span><strong>{claimsLabel(report.total)}</strong></span>
            {ORDER.filter((s) => report.summary[s]).map((s) => (
              <span key={s}><span className="dot" style={{ background: `var(--${s})` }} />{STATUS[s]}: <strong>{report.summary[s]}</strong></span>
            ))}
          </div>
          <ol className="claims">
            {report.claims.map((c, i) => <Claim key={i} c={c} />)}
          </ol>
        </>
      )}

      <footer>
        <p>جِهْبَاذ أداة ذكاء اصطناعي تنقل أحكام أهل العلم منسوبةً إليهم، ولا تُفتي ولا تجتهد في الحكم. راجع المصدر قبل الاعتماد.</p>
        <p>المصادر: <a href="https://quranpedia.net">الموسوعة القرآنية</a> · <a href="https://dorar.net">الدرر السنية</a> · <a href="https://hadeethenc.com">موسوعة الأحاديث النبوية</a></p>
      </footer>
    </main>
  );
}
