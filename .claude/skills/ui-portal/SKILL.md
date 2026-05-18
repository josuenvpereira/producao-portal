---
name: ui-portal
description: Diretriz de UI/UX para a SPA do producao-portal (React 18 + Vite). Use ao criar ou alterar componentes, páginas ou estilos em web/. Destila o frontend-design da Anthropic (fugir de estética genérica, intencionalidade, tipografia/tema deliberados) MAS reorientado para um portal interno read-only de observabilidade: legibilidade de dashboards/tabelas/grafos e estados (loading/empty/stale/degraded) vêm antes de impacto visual. Respeita a CSP self-only e a stack mínima do projeto.
---

# ui-portal — UI do producao-portal (observabilidade > impacto)

Adaptação do plugin oficial `frontend-design` ao contexto real: o portal é
**read-only, interno, de observabilidade** (esteira de vídeo, custos,
comunicação, organograma reactflow, SFX). O usuário é o operador, não um
visitante. O que importa: **ler estado rápido, densidade legível, sinais de
saúde claros** — não "inesquecível".

## Princípio que mantemos do frontend-design

- **Fugir de "AI slop"**: nada de layout/cor/fonte clichê por inércia
  (gradiente roxo em fundo branco, fonte genérica sem intenção, card
  padrãozão). Toda escolha visual é deliberada.
- **Intencionalidade > intensidade**: o próprio skill original diz que
  *minimalismo refinado* é tão válido quanto maximalismo. Aqui o alvo é
  **minimalismo refinado e denso** — execução precisa de espaçamento,
  hierarquia e tipografia, não ousadia decorativa.

## O que NÃO trazer do frontend-design (desalinhado com o portal)

- Maximalismo, layouts diagonais/assimétricos, grid-breaking, overlap
  dramático → prejudicam scan de tabela/KPI/grafo.
- Animações de alto impacto, scroll-triggered surprises, cursores custom,
  grain/noise → ruído num painel de dados.
- "Motion library for React" ou qualquer lib de animação/charting → **viola
  a stack mínima**. Charts são SVG inline (ver `MiniBars`/`Bars`); animação
  é CSS puro (`transform`/`opacity`), curta e funcional.
- Fontes externas/Google Fonts → **viola a CSP** (ver abaixo).

## Regras duras do projeto (não negociáveis)

1. **CSP self-only em produção** (`src/server.ts`): `scriptSrc 'self'`,
   `styleSrc 'self' 'unsafe-inline'`, `imgSrc 'self' data:`,
   `connectSrc 'self'`. Logo: zero CDN, zero Google Fonts (fonte = stack do
   sistema ou self-hosted/bundlada), zero `<script>` externo, zero fetch
   para fora de `/api`, imagens só `self`/`data:`.
2. **Stack mínima** (CLAUDE.md): NÃO adicionar dependência em `web/` sem
   aprovação explícita. React 18 + react-router + reactflow é o que há.
3. **tsconfig da web** tem `noUnusedLocals`/`noUnusedParams`: nada de import
   ou variável sobrando. Imports da SPA são **extensionless** (Vite).
4. Validar com a skill **`validate`** (o `web build` roda `tsc --noEmit`
   antes do vite) antes de commit que vá pra `main`.

## Sempre reusar a base que já existe (não recriar)

Antes de escrever UI nova, leia `web/src/components.tsx` e use o que houver:

- `Kpi`, `Panel`, `Bars`, `MiniBars` (SVG, `aria-hidden`), `StateBadge`
  (cores semânticas: `b-err`/`b-warn`/`b-done`/`b-prog`/`b-idle`),
  `Banner` (avisos de degradação), `Loading` (loading/erro).
- Helpers `fmtUsd`, `fmtDate` (sempre `pt-BR`).
- Classes/CSS existentes: `card`, `panel-head`, `tbl`, `muted`, `mono`,
  `chip`, `grid`, `kpis`. Estilo via **CSS variables** (`var(--chart)`
  etc.) que resolvem em `[data-theme=dark]` — **claro E escuro têm que
  funcionar**; nunca hardcodar cor. Tema em `web/src/theme.ts`.

Se faltar um componente, estenda a biblioteca em `components.tsx` no mesmo
padrão — não introduza um sistema paralelo.

## Estados são feature de primeira classe

O backend **degrada graciosamente** (fonte fora → dado stale + nota, nunca
crash). A UI tem que refletir isso com calma, sem alarme falso:

- **Loading/erro**: `if (!data) return <Loading error={error} />` (padrão de
  todas as páginas; ver `pages/Overview.tsx`).
- **Degradado/stale**: `<Banner notes={data.degraded} />` no topo. Fonte
  offline é **estado normal** (ex.: SFX com a casa desligada = badge cinza,
  não erro vermelho). Não trate ausência de dado como falha.
- **Vazio**: linha explícita no `<tbody>` (`sem X ainda` / `pro filtro`),
  nunca tabela em branco sem explicação.
- **Tempo real**: dados vêm via `useApi` + `useRefreshTick`; atualize sem
  layout-shift brusco; "Atualizado: …" como `chip` discreto.

## Qualidade visual para dados

- **Hierarquia**: o número/estado que importa salta primeiro (padrão `Kpi`:
  label pequeno, value grande, foot com tom `pos`/`neg`/`warn`).
- **Densidade**: tabela legível e escaneável > "ar". Números em `mono`,
  alinhados à direita; truncar com ellipsis + não quebrar layout.
- **Cor com significado**: status nunca depende só de cor — `StateBadge`
  tem texto. Mantenha contraste alto (são dados); foco de teclado visível;
  `aria-hidden` no que é decorativo (charts).
- **Tipografia**: deliberada e consistente via tokens; não trocar fonte por
  página. Refinada, não chamativa.
- **Movimento**: só transição funcional curta (feedback/estado) em
  `transform`/`opacity`. Sem reflow, sem espetáculo.

## Checklist antes de entregar UI

- [ ] Reusou `components.tsx`/classes existentes; sem componente duplicado
- [ ] Cores via CSS var; testado em claro **e** escuro
- [ ] loading + erro + vazio + degradado/stale tratados
- [ ] Zero dependência nova; charts SVG; animação CSS
- [ ] CSP-safe (sem fonte/asset/script externo)
- [ ] Texto em pt-BR; datas/moeda via `fmtDate`/`fmtUsd`
- [ ] `validate` verde (tsc sem unused + vite build)
