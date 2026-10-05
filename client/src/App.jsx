import { useEffect, useMemo, useState } from 'react';
import { buildDocumented } from './documented.js';

const STATUS = {
  exact: 'مطابق لمصدره',
  variant: 'وُجد بلفظ مختلف',
  weak: 'نُقل تضعيفه',
  not_found: 'لم يُعثر عليه',
  review: 'يحتاج مراجعة مختص',
  unavailable: 'تعذّر الوصول إلى المصدر',
  refer: 'خارج نطاق التحقق: يُحال إلى مختص',
};
const ORDER = ['exact', 'variant', 'weak', 'not_found', 'review', 'refer', 'unavailable'];

const SAMPLE = `إن العبادة غاية الخلق، قال تعالى: ﴿وما خلقت الجن والإنس إلا ليعبدوني﴾. وقال رسول الله ﷺ: «إنما الأعمال بالنيات». ويُروى أن النبي ﷺ قال: اطلبوا العلم ولو بالصين. ومن العبارات المتداولة «حب الوطن من الإيمان». وقال النبي ﷺ: إن الله مع الصابرين.`;

function Diff({ ops, mergedWords }) {
  return ops.map((o, i) => {
    if (o.type === 'equal') return <span key={i}>{o.said.join(' ')} </span>;
    if (mergedWords && o.said.length && o.said.every((w) => mergedWords.has(w))) {
      return <span key={i} className="merged" title="من آية أخرى">{o.said.join(' ')} </span>;
    }
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
      {q.translation && (
        <>
          <p className="text en" dir="ltr">{q.translation.text}</p>
          <span>
            <a href={q.translation.url} target="_blank" rel="noreferrer">{q.translation.title}</a>
            {` · الإصدار ${q.translation.version} · QuranEnc.com · طوبق الاقتباس مع هذه الترجمة، ثم رُدّ إلى الآية في المصحف`}
          </span>
        </>
      )}
      <p className="text">﴿{q.text}﴾</p>
      <span>{ayahRef(q.ref)}{fragment ? ' · المقتبس جزء من الآية' : ''} · مصحف حفص، <a href="https://quranpedia.net" target="_blank" rel="noreferrer">الموسوعة القرآنية</a></span>
      {q.alternatives?.length > 0 && (
        <span> · وورد اللفظ أيضًا في: {q.alternatives.map(ayahRef).join('، ')}</span>
      )}
    </div>
  );
}

// Which of the two Sahih collections HadeethEnc's takhrij names (for the lead line)
function sahihaynOf(attr) {
  const t = String(attr || '');
  const b = /البخاري/.test(t), m = /مسلم/.test(t) || /متفق عليه/.test(t);
  if (/متفق عليه/.test(t) || (b && m)) return 'البخاري ومسلم';
  return b ? 'البخاري' : m ? 'مسلم' : null;
}

function HadithSource({ h, he }) {
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
      <span>{lead.source}{lead.number ? `، ${lead.number}` : ''}{lead.rawi && lead.rawi !== '-' ? ` · الراوي: ${lead.rawi}` : ''} · <a href={`https://dorar.net/hadith/search?q=${encodeURIComponent(String(lead.text || '').replace(/[.\s]+$/, '').split(/\s+/).slice(0, 8).join(' '))}`} target="_blank" rel="noreferrer">الدرر السنية</a></span>
      {!lead.sahihayn && !alsoIn && sahihaynOf(he?.attribution) && (
        <div className="sahihayn">وأصله عند {sahihaynOf(he.attribution)}، وفق تخريج موسوعة الأحاديث النبوية</div>
      )}
      {alsoIn && (
        <div>وأصله في {alsoIn.source}{alsoIn.number ? `، ${alsoIn.number}` : ''} بلفظ: {alsoIn.text}</div>
      )}
      {verdicts && (
        <div>أحكام الروايات المطابقة: {[
          verdicts.strong && `${verdicts.strong} بالتصحيح`,
          verdicts.isnad && `${verdicts.isnad} بتصحيح الإسناد`,
          verdicts.weak && `${verdicts.weak} بالتضعيف`,
          verdicts.fabricated && `${verdicts.fabricated} بالوضع`,
          verdicts.other && `${verdicts.other} أخرى`,
        ].filter(Boolean).join('، ')}</div>
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

function HadeethEncSource({ he, translated, second }) {
  if (!he?.text) return null;
  return (
    <div className="source">
      {second && <div className="path">ومن مسار مستقل ثانٍ:</div>}
      {translated && he.en?.text && <p className="text en" dir="ltr">{he.en.text}</p>}
      <p className="text">{he.text}</p>
      <div className="verdict">{translated ? 'حكم الأصل العربي' : 'الحكم'}: <q>{he.grade}</q></div>
      {he.attribution && (he.attribution.length <= 90
        ? <div>{he.attribution}</div>
        : <details><summary>{he.attribution.slice(0, 70)}… عرض التخريج كاملًا</summary><div>{he.attribution}</div></details>)}
      <span>
        <a href={he.url} target="_blank" rel="noreferrer">موسوعة الأحاديث النبوية</a>
        {translated && he.match === 'meaning'
          ? ` · مطابقة بالمعنى مع الترجمة المعتمدة (تشابه ${Math.round(he.similarity * 100)}%)، ثم رُدّ إلى أصله العربي`
          : translated ? ' · طوبق الاقتباس مع الترجمة الإنجليزية المعتمدة، ثم رُدّ إلى أصله العربي' : ''}
      </span>
    </div>
  );
}

function Claim({ c }) {
  const ops = c.meaning ? null : (c.quran?.ops || c.hadith?.lead?.ops || c.hadeethenc?.ops);
  // Hadith badges describe what the sources say, never a verdict of our own
  const HADITH = {
    sahihayn: ['في الصحيحين، ومطابق', 'في الصحيحين، بلفظ مختلف'],
    sahihayn_he: ['في الصحيحين، ومطابق', 'في الصحيحين، بلفظ مختلف'],
    graded_authentic: ['نُقل تصحيحه، ومطابق', 'نُقل تصحيحه، بلفظ مختلف'],
    hadeethenc: ['في موسوعة الأحاديث، ومطابق', 'في موسوعة الأحاديث، بلفظ مختلف'],
    disputed: 'اختلفت أحكام العلماء: يُحال إلى مختص',
    graded_weak: 'نُقل تضعيفه',
    graded_fabricated: 'نُقل الحكم بوضعه',
    isnad_only: 'نُقل تصحيح إسناده فقط: يُراجع مختص',
    not_explicit: 'حكم غير صريح: يُراجع مختص',
  };
  const h = c.kind === 'hadith' && !c.meaning ? HADITH[c.basis] : null;
  const label = c.misattributed && c.status === 'variant' ? 'نصّه ثابت، ونسبته خاطئة'
    : c.merged ? 'آيتان دُمجتا في اقتباس واحد'
    : c.meaning ? (c.closeness === 'high' ? 'يوافق معنى حديث: الترجمة تحتاج مراجعة' : 'قريب في المعنى: يحتاج مراجعة')
    : Array.isArray(h) ? h[c.status === 'exact' ? 0 : 1]
    : h || STATUS[c.status];
  // Hafs is the reference; another mutawatir reading can legitimately differ
  const qiraat = c.kind === 'quran' && c.status === 'variant' && !c.merged && !c.misattributed && !c.translated;

  return (
    <li className="claim" style={{ '--c': `var(--${c.status})` }}>
      <span className="badge"><span className="dot" style={{ background: 'var(--c)' }} />{label}</span>
      <span className="kind">{c.type === 'question' ? 'سؤال' : c.unmarked ? (c.type === 'quran' ? 'آية في النص دون علامة' : 'حديث في النص دون نسبة') : c.type === 'quran' ? 'نُقل آيةً' : c.type === 'hadith' ? 'نُقل حديثًا' : 'نص منقول'}{c.translated ? ' · مترجم' : ''}{c.paths === 2 ? ' · تحقق من مسارين مستقلين' : ''}</span>
      <p className="quote" dir="auto">{ops && c.status !== 'not_found'
        ? <Diff ops={ops} mergedWords={c.merged ? new Set(c.merged.part.split(/\s+/)) : null} />
        : c.text}</p>
      {c.note && <p className="note">{c.note}</p>}
      {qiraat && <p className="note">إن كان الاقتباس بقراءة متواترة غير رواية حفص فقد يكون الفرق صحيحًا؛ والفصل فيه لمختص في القراءات.</p>}
      {c.kind === 'refer' ? null : c.kind === 'quran' ? <QuranSource q={c.quran} fragment={c.fragment} /> : (
        <>
          {c.hadith?.lead || !c.hadeethenc ? <HadithSource h={c.hadith} he={c.hadeethenc} /> : null}
          <HadeethEncSource he={c.hadeethenc} translated={c.translated} second={!!c.hadith?.lead} />
        </>
      )}
      {c.merged && (c.merged.parts ? c.merged.parts.slice(1).map((p, i) => <QuranSource key={i} q={p.quran} fragment />) : <QuranSource q={c.merged.quran} fragment />)}
    </li>
  );
}

export default function App() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [heState, setHeState] = useState(null);
  const [copied, setCopied] = useState(false);
  const documented = useMemo(() => (report?.total ? buildDocumented(report.source, report.claims) : ''), [report]);

  async function copyDocumented() {
    try { await navigator.clipboard.writeText(documented); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }
  function downloadDocumented() {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + documented], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'jihbath-documented.txt' });
    a.click(); URL.revokeObjectURL(url);
  }

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((d) => setHeState(d?.sources?.hadeethenc?.state)).catch(() => {});
  }, []);

  async function check() {
    setBusy(true); setError(''); setReport(null);
    try {
      const r = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setReport({ ...data, source: text });
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

      {heState === 'initializing' && (
        <p className="notice">موسوعة الأحاديث النبوية قيد التهيئة على الخادم، وهذا يحدث مرة واحدة فقط. التحقق من الآيات والأحاديث يعمل الآن عبر الموسوعة القرآنية والدرر السنية، ويُضاف المسار الثاني للأحاديث والمحتوى الإنجليزي تلقائيًا عند اكتمال التهيئة.</p>
      )}

      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="الصق النص هنا…" aria-label="النص المراد التحقق منه" />
      <div className="actions">
        <button className="primary" onClick={check} disabled={busy || !text.trim()}>{busy ? 'جارٍ التحقق…' : 'تحقّق من النص'}</button>
        <button className="quiet" onClick={() => { setText(SAMPLE); setReport(null); }}>جرّب نصًّا نموذجيًّا</button>
        {(text || report) && <button className="quiet" onClick={() => { setText(''); setReport(null); setError(''); }}>مسح النص</button>}
        {busy && <span className="status-line">تُراجَع الأحاديث في الدرر السنية واحدًا واحدًا، وقد يستغرق ذلك ثواني.</span>}
      </div>
      {error && <p className="error">{error}</p>}

      {report && report.total === 0 && (
        <p className="empty">لا توجد في النص آيات أو أحاديث منقولة. ضع الآية بين ﴿ ﴾، أو الحديث بعد «قال رسول الله ﷺ». وجِهْبَاذ يتحقق من النصوص المنقولة، ولا يجيب عن الأسئلة.</p>
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

      {report && report.total > 0 && (
        <section className="documented" aria-label="النص الموثق">
          <h2>النص الموثَّق</h2>
          <p className="hint">نصّك كما كتبته، والتصحيحات في مواضعها مع توثيق مختصر بين معقوفين، جاهزًا للنشر. لا يُحذف منه شيء ولا يُولَّد فيه شيء: ما لم يثبت يبقى بلفظك ويُعلَّم بحكم العالم.</p>
          <div className="doc-text" dir="auto">{documented}</div>
          <div className="actions">
            <button className="primary" onClick={copyDocumented}>{copied ? 'نُسخ ✓' : 'نسخ النص'}</button>
            <button className="quiet" onClick={downloadDocumented}>تنزيل</button>
          </div>
        </section>
      )}

      <footer>
        <p>جِهْبَاذ أداة ذكاء اصطناعي تنقل أحكام أهل العلم منسوبةً إليهم، ولا تُفتي ولا تجتهد في الحكم. راجع المصدر قبل الاعتماد.</p>
        <p>المصادر: <a href="https://quranpedia.net">الموسوعة القرآنية</a> · <a href="https://quranenc.com">موسوعة القرآن الكريم</a> · <a href="https://dorar.net">الدرر السنية</a> · <a href="https://hadeethenc.com">موسوعة الأحاديث النبوية</a></p>
        <p className="rights">© 2026 جِهْبَاذ <span className="sep">‖</span> JIHBATH · تطوير: عبدالله الزهراني – مؤسس <a href="https://lcaptainai.captndx.com" target="_blank" rel="noreferrer">CAPTndx</a> · النصوص والأحكام منقولة من مصادرها المذكورة مع كل نتيجة</p>
      </footer>
    </main>
  );
}
