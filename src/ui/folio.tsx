import type { ComponentChildren } from 'preact';

/** Building blocks of the manuscript side panels: rubricated sections of label and value rows. */

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="folio-sec">
      <h3><span class="initial">{title[0]}</span>{title.slice(1)}</h3>
      <dl class="rows">{children}</dl>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return <div class="row"><dt>{label}</dt><dd>{children}</dd></div>;
}

/** A field whose simulation does not exist yet: a dash, and when it comes on hover. */
export function Pending({ label, when }: { label: string; when: string }) {
  return <div class="row pending" title={`Arrives with ${when}`}><dt>{label}</dt><dd>—</dd></div>;
}
