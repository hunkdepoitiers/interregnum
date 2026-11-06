import { useState } from 'preact/hooks';
import { command, status, world } from '../bridge/client';
import { dayToDate, formatDate } from '../sim/calendar';
import { LEDGER, ledgerNet } from '../sim/economy';
import { mapData } from './App';
import { money, percent, signedMoney, treasuryOpen, useReport } from './economy';
import { Row, Section } from './folio';
import { CoatOfArms } from './heraldry';
import { content } from './StatList';

/** The treasury screen: ledger, credit, debts, borrowing, tax law and works, for any realm; actions for the player's. */
export function TreasuryPanel() {
  const id = treasuryOpen.value;
  const realm = world.value?.realms[id];
  const report = useReport(realm ? { kind: 'realm', id } : null);
  const [bank, setBank] = useState(-1);
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState(0);
  const [pledge, setPledge] = useState(false);
  const c = content.value;
  if (!realm || !report || !c) return null;
  const e = c.economy;
  const mine = status.value.player === id;
  const name = (pid: number) => mapData.value?.provinces.find((p) => p.id === pid)?.name ?? '—';
  const lines = LEDGER.filter((l) => report.ledger[l.key] || report.projected[l.key]);
  const lending = report.offers.filter((o) => !o.refusal && o.max > 0);
  const offer = report.offers[bank] ?? lending[0];
  const term = months || e.credit.terms[0]!;
  const want = Math.round(Number(amount) * 100);
  const borrow = () => {
    if (!offer || !(want > 0)) return;
    command({ type: 'takeLoan', realm: id, bank: offer.bank, amount: Math.min(want, offer.max), months: term, pledge: pledge ? realm.capital : 0 });
    setAmount('');
  };

  return (
    <aside class="treasury-panel folio panel" aria-label="Treasury">
      <header class="folio-head realm-head">
        <CoatOfArms realm={realm} size={56} />
        <div class="cartouche">
          <h2>The Treasury</h2>
          <p class="sub">{realm.name}</p>
        </div>
        <button class="close" aria-label="Close" onClick={() => (treasuryOpen.value = 0)}>×</button>
      </header>
      <div class="folio-body">
        <Section title="The Purse">
          <Row label="In the treasury"><span class={report.treasury < 0 ? 'warn' : ''}>{money(report.treasury)} ducats</span></Row>
          <Row label="This month, so far">{signedMoney(ledgerNet(report.projected))}</Row>
          <Row label="Last month">{signedMoney(ledgerNet(report.ledger))}</Row>
        </Section>

        <section class="folio-sec">
          <h3><span class="initial">L</span>edger</h3>
          <table class="ledger">
            <thead><tr><th /><th>Last month</th><th>This month</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} class={l.kind}>
                  <td>{l.label}</td>
                  <td>{report.ledger[l.key] ? signedMoney(report.ledger[l.key]!) : ''}</td>
                  <td>{report.projected[l.key] ? signedMoney(report.projected[l.key]!) : ''}</td>
                </tr>
              ))}
              <tr class="total"><td>Balance</td><td>{signedMoney(ledgerNet(report.ledger))}</td><td>{signedMoney(ledgerNet(report.projected))}</td></tr>
            </tbody>
          </table>
        </section>

        <Section title="Credit">
          <Row label="Rating"><strong>{report.credit.value}</strong> <span class="muted">of 100</span></Row>
          {report.credit.lines.map((l) => <div class="row sub-row" key={l.label}><dt>{l.label}</dt><dd>{l.value > 0 && l.label !== report.credit.lines[0]!.label ? '+' : ''}{l.value}</dd></div>)}
          <Row label="Debts">{money(report.credit.debt)} ducats</Row>
        </Section>

        {report.loans.length > 0 && (
          <section class="folio-sec">
            <h3><span class="initial">D</span>ebts</h3>
            <ul class="plain loans">
              {report.loans.map((l) => (
                <li key={l.id}>
                  <div><strong>{money(l.principal)}</strong> from {e.banks[l.bank]?.name}</div>
                  <div class="muted small">
                    {percent(l.rate)} a year · due {formatDate(dayToDate(l.due))}{l.pledge ? ` · ${name(l.pledge)} pledged` : ''}
                  </div>
                  {mine && (
                    <button class="small-btn" disabled={report.treasury < l.principal} onClick={() => command({ type: 'repayLoan', realm: id, loan: l.id })}>
                      Repay
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {mine && (
          <section class="folio-sec">
            <h3><span class="initial">B</span>orrow</h3>
            {lending.length === 0 ? <p class="muted small">No house will lend to you now.</p> : (
              <div class="borrow">
                <label>
                  House
                  <select value={offer?.bank} onChange={(ev) => setBank(Number((ev.target as HTMLSelectElement).value))}>
                    {lending.map((o) => <option key={o.bank} value={o.bank}>{e.banks[o.bank]!.name} · {percent(o.rate)} · up to {money(o.max)}</option>)}
                  </select>
                </label>
                <label>
                  Ducats
                  <input type="number" min="1" max={offer ? offer.max / 100 : 0} value={amount} placeholder={offer ? `up to ${money(offer.max)}` : ''}
                    onInput={(ev) => setAmount((ev.target as HTMLInputElement).value)} />
                </label>
                <label>
                  For
                  <select value={term} onChange={(ev) => setMonths(Number((ev.target as HTMLSelectElement).value))}>
                    {e.credit.terms.map((t) => <option key={t} value={t}>{t} months</option>)}
                  </select>
                </label>
                <label class="check">
                  <input type="checkbox" checked={pledge} onChange={(ev) => setPledge((ev.target as HTMLInputElement).checked)} />
                  Pledge the revenues of {name(realm.capital)} (2 points less interest)
                </label>
                <button disabled={!offer || !(want > 0) || want > (offer?.max ?? 0)} onClick={borrow}>Borrow</button>
              </div>
            )}
            {report.offers.filter((o) => o.refusal).map((o) => (
              <p key={o.bank} class="muted small">{e.banks[o.bank]!.name}: {o.refusal}</p>
            ))}
          </section>
        )}

        <section class="folio-sec">
          <h3><span class="initial">T</span>ax law</h3>
          {e.taxLaws.map((l) => (
            <label key={l.key} class={`law${report.taxLaw === l.key ? ' on' : ''}`} title={l.description}>
              <input
                type="radio"
                name="tax-law"
                checked={report.taxLaw === l.key}
                disabled={!mine || report.lawWait > 0}
                onChange={() => command({ type: 'setTaxLaw', realm: id, law: l.key })}
              />
              <span><strong>{l.name}</strong><br /><span class="muted small">{l.description}</span></span>
            </label>
          ))}
          {mine && report.lawWait > 0 && <p class="muted small">The law can change again in {report.lawWait} days.</p>}
        </section>

        {report.construction.length > 0 && (
          <Section title="Works">
            {report.construction.map((w) => (
              <Row key={`${w.province}-${w.building}`} label={`${e.buildings.find((b) => b.key === w.building)?.name ?? w.building}, ${name(w.province)}`}>
                <span class="muted">{Math.max(0, w.done - status.value.day)} days</span>
              </Row>
            ))}
          </Section>
        )}

        {mine && report.loans.length > 0 && (
          <div class="danger">
            <button
              onClick={() => {
                if (window.confirm('Refuse to pay every debt? Your credit, legitimacy and the lenders will not forget.')) command({ type: 'repudiate', realm: id });
              }}
            >
              Repudiate all debts
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
