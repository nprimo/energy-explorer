# Períodos horários (Portugal continental): primary sources

Where the "brackets" for vazio / cheias / ponta actually come from. Researched 2026-08-29.

## TL;DR

- The authority that defines the brackets is **ERSE** (the regulator), not E-REDES. E-REDES (the DSO) only applies them by parametrizing meters.
- The brackets currently in force (and shown on https://www.tiagofelicia.pt/periodos-horarios) are approved **annually** in ERSE's tariff directives. The current one is **Diretiva n.º 1/2026** (DR, 7 January 2026; ERSE internal numbering: Diretiva n.º 10/2025), "Períodos horários em Portugal continental", art. 36.º of the Regulamento Tarifário.
- A **new** set of brackets was approved on **31 July 2026** by **Diretiva n.º 3/2026** (ERSE). It takes effect 1 April 2027 for MAT/AT/MT/BTE and July–December 2027 (gradual, per-meter parametrization) for BTN. Anyone building on the tiagofelicia-style tables should plan for this change.

## Legal chain

1. **Regulamento Tarifário do setor elétrico (RT)** — approves Regulamento n.º 1218/2025, de 7 de novembro (Diário da República; ERSE numbering: Regulamento n.º 2/2025). Article 36.º defines the four periods (ponta, cheias, vazio normal, super vazio) and the counting cycles (ciclo diário, ciclo semanal, ciclo semanal opcional, ciclo semanal por épocas) but not the hour locations.
2. **Annual tariff directive** — the hour locations (the actual "brackets") are set in the "Períodos horários em Portugal continental" section of the yearly directive approving tariffs and prices:
   - Diretiva n.º 1/2026, de 7 de janeiro (in force for 2026): https://diariodarepublica.pt/dr/detalhe/diretiva/1-2026-998612388 (PDF: https://files.diariodarepublica.pt/2s/2026/01/004000000/0018600288.pdf)
   - Diretiva n.º 12/2024 (2025 tariffs), Secção XI: https://www.erse.pt/media/12ibss3c/diretiva-erse-12-2024-tse-2025.pdf
3. **Diretiva n.º 3/2026** — standalone directive approving the new brackets (next section): https://www.erse.pt/media/yhtlkvzs/diretiva-per%C3%ADodos-hor%C3%A1rios.pdf

## Current brackets (BTN, in force 2026, matching tiagofelicia)

From Diretiva n.º 1/2026 / Diretiva n.º 12/2024 tables. The four regulated periods are ponta, cheias, vazio normal, super vazio. For 2-period (bi-horário) and 3-period (tri-horário) tariffs:

- **Vazio** = vazio normal + super vazio
- **Fora de vazio** (bi) / **Cheias + Ponta** (tri) = cheias + ponta

Ciclo diário (BTN/BTE, all days of the year):

| Período      | Inverno                               | Verão                                 |
| ------------ | ------------------------------------- | ------------------------------------- |
| Ponta        | 09:00–10:30, 18:00–20:30              | 10:30–13:00, 19:30–21:00              |
| Cheias       | 08:00–09:00, 10:30–18:00, 20:30–22:00 | 08:00–10:30, 13:00–19:30, 21:00–22:00 |
| Vazio normal | 06:00–08:00, 22:00–02:00              | same                                  |
| Super vazio  | 02:00–06:00                           | same                                  |

(The "22:00–08:00 vazio" on the site = super vazio 02:00–06:00 + vazio normal 22:00–02:00 and 06:00–08:00.)

Ciclo semanal (BTN/BTE): dias úteis / sábados / domingos × inverno / verão tables in the directive; they match the site's weekly tables exactly (e.g., winter weekdays ponta 09:30–12:00 and 18:30–21:00).

National holidays count as "normal days" for BTN (site's FAQ is right; the holiday-as-Sunday rule in the directives applies to MAT/AT/MT).

## New brackets (Diretiva n.º 3/2026, from 2027)

Approved 31 July 2026, following Consulta Pública n.º 137. Highlights for BTN:

- Ciclo diário no longer distinguishes verão/inverno:
  - Ponta: 17:30–21:30
  - Cheias: 08:30–17:30, 21:30–22:30
  - Vazio normal: 00:00–02:30, 06:30–08:30, 22:30–24:00
  - Super vazio: 02:30–06:30
  - → bi-horário vazio = 22:30–08:30; fora de vazio starts at 08:30 (previously 08:00)
- Ciclo semanal keeps verão/inverno and a ponta block shifted to late afternoon (winter weekdays ponta 17:00–22:00 instead of 09:30–12:00 / 18:30–21:00).
- Schedule: MAT/AT/MT/BTE from 1 April 2027; BTN bi/tri-horário meters parametrized July–December 2027 (64% by end August, 91% by end September, 100% by end December); BTN simples meters by March 2030.

Supporting docs (ERSE): comunicado https://www.erse.pt/media/4kply050/comunicado_novos-per%C3%ADodos-hor%C3%A1rios.pdf, consultation docs CP137 (https://www.erse.pt/media/olwlg0tu/cp137-doc-enquadramento.pdf), study in "Estrutura Tarifária do Setor Elétrico em 2025", chapter 5–6 (https://www.erse.pt/media/fsnmfjgi/estrutura-tarif%C3%A1ria-se-2025-dez2024.pdf).

## History (why the brackets look like this)

- Three counting cycles (diário, semanal, semanal opcional) in continental Portugal date from the **2005 tariffs**.
- Last revision of the hour **locations** before 2026 was in **2009**; in **2024** the ciclo semanal por épocas was added for MAT/AT/MT (ERSE, CP137 enquadramento).
- Earlier, the periods horários lived in the Regulamento de Acesso às Redes / Regulamento Tarifário approved by Despacho n.º 19624-A/2006, de 25 de setembro, and later RT revisions (e.g., Regulamento n.º 496/2011). ERSE's full act list: https://www.erse.pt/biblioteca/atos-e-documentos-da-erse/
- Hora legal (verão/inverno split) is defined by Decreto-Lei n.º 17/96, de 8 de março (winter from last Sunday of October to last Sunday of March).

## ERSE plain-language references

- "Períodos horários na energia elétrica em Portugal" (Sep 2020, diagram versions of all BTN tables): https://www.erse.pt/media/eghpl05v/periodos-hor%C3%A1rios-de-energia-el%C3%A9trica-em-portugal_set2020.pdf
- "Opções horárias" (consumer guide): https://www.erse.pt/media/bhglkak0/opcoeshorarias_set2020.pdf
- Q&A on the 2026 update: https://www.erse.pt/media/02xfatwv/cp137_ph_ersexplica_perguntas_e_respostas.pdf

## Role of E-REDES

E-REDES publishes the brackets only as an implementer: meter parametrization specs (e.g., DEF-C44-517/N, https://www.e-redes.pt/sites/eredes/files/2022-10/DEF-C44-517N_0.pdf) and the Guia de Medição, Leitura e Disponibilização de Dados (https://www.e-redes.pt/sites/eredes/files/2019-02/GMLDD2016.pdf) cite the ERSE/RT periods. Cite ERSE directives as the source of truth.

## Renewal checklist (yearly)

When: **15 November – 15 February**. That window covers ERSE's proposta de tarifas (mid-November), final approval (late December), and DR publication (late December – early February, e.g. Diretiva n.º 1/2026 on 7 Jan 2026).

1. Check ERSE's "Tarifas e preços — eletricidade" page (https://www.erse.pt/atividade/regulacao/tarifas-e-precos-eletricidade/) and the Diário da República for the new annual directive.
2. Download the directive PDF, `pdftotext`, and diff the "Períodos horários em Portugal continental" tables against the current version in the tariff calendar module. Most years they are reprinted unchanged — add the new version row (id, sourceUrl, validity) so the audit trail stays complete.
3. If the tables changed, review the diff against the module's invariants (quarter-hour boundaries, four regulated periods, collapse rules) and update the seed as a reviewed commit.
4. Watch for **consultas públicas (CP)** about períodos horários year-round — they precede bracket changes by 1–2 years (estudo Dec 2024 → CP137 Nov 2025–Jan 2026 → Diretiva n.º 3/2026 → effect 2027). A scheduled job grepping ERSE's tarifas page for CP announcements is enough.
5. For the 2027 BTN rollout specifically: bracket application is per-meter (July–December 2027). Keep per-user version override available until it completes.
