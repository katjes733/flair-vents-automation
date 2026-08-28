# HVAC Pressure Safety & Duct-Closure Research — Findings for `topologyLimits.ts`

- [HVAC Pressure Safety & Duct-Closure Research — Findings for `topologyLimits.ts`](#hvac-pressure-safety--duct-closure-research--findings-for-topologylimitsts)
  - [This installation's actual unit: BIVA-60RCB-M20X and BOVA-60RTB-M20S](#this-installations-actual-unit-biva-60rcb-m20x-and-bova-60rtb-m20s)
    - [Documents confirmed to match this exact model](#documents-confirmed-to-match-this-exact-model)
    - [Nomenclature check — these documents really do describe this house's nameplate models](#nomenclature-check--these-documents-really-do-describe-this-houses-nameplate-models)
    - [The real CFM-vs-ESP table for Model Size 60](#the-real-cfm-vs-esp-table-for-model-size-60)
    - [Which tap runs when Y1 and Y2 are jumpered](#which-tap-runs-when-y1-and-y2-are-jumpered)
    - [The CFM-per-ton band is confirmed IDS-specific, and heat-kit-dependent](#the-cfm-per-ton-band-is-confirmed-ids-specific-and-heat-kit-dependent)
    - [Computed result: does High Stage stay in band across the published ESP range](#computed-result-does-high-stage-stay-in-band-across-the-published-esp-range)
    - [How this section supersedes the earlier 3-ton IDP example](#how-this-section-supersedes-the-earlier-3-ton-idp-example)
  - [How this was gathered](#how-this-was-gathered)
  - [Executive summary](#executive-summary)
  - [1. General duct-closure / static-pressure guidance by blower type](#1-general-duct-closure--static-pressure-guidance-by-blower-type)
    - [ACCA Manual Zr's own taxonomy of blower motors](#acca-manual-zrs-own-taxonomy-of-blower-motors)
    - [What Manual Zr actually says happens as zones close](#what-manual-zr-actually-says-happens-as-zones-close)
    - [The numeric anchors Manual Zr actually publishes](#the-numeric-anchors-manual-zr-actually-publishes)
    - [What Manual Zr deliberately does NOT publish](#what-manual-zr-deliberately-does-not-publish)
  - [2. Bosch-specific documentation (IDP Premium / IDS platform)](#2-bosch-specific-documentation-idp-premium--ids-platform)
    - [Documents used](#documents-used)
    - [Blower type correction: "constant torque," not constant-airflow](#blower-type-correction-constant-torque-not-constant-airflow)
    - [Real airflow-performance (CFM vs. ESP) data](#real-airflow-performance-cfm-vs-esp-data)
    - [Y1/Y2 bridging — confirmed, not just an installer convention](#y1y2-bridging--confirmed-not-just-an-installer-convention)
    - [The actual safety trip Bosch documents: refrigerant-side HPS, not a duct-pressure switch](#the-actual-safety-trip-bosch-documents-refrigerant-side-hps-not-a-duct-pressure-switch)
    - [What Bosch's own docs do NOT say](#what-boschs-own-docs-do-not-say)
  - [3. Is "stage count" the right variable, or is it the blower's own curve?](#3-is-stage-count-the-right-variable-or-is-it-the-blowers-own-curve)
  - [4. ACCA Manual D / Manual Zr / ASHRAE — direct numeric guidance](#4-acca-manual-d--manual-zr--ashrae--direct-numeric-guidance)
  - [Practitioner/secondary numbers found — explicitly NOT primary-sourced](#practitionersecondary-numbers-found--explicitly-not-primary-sourced)
  - [Engineering inferences for this project (not stated by any source)](#engineering-inferences-for-this-project-not-stated-by-any-source)
  - [Open items / unconfirmed](#open-items--unconfirmed)
  - [Sources](#sources)

## This installation's actual unit: BIVA-60RCB-M20X and BOVA-60RTB-M20S

**This section supersedes the generic 3-ton IDP example used elsewhere in this document for this specific project.** A prior research pass used a 3-ton **IDP** (packaged unit) table as a stand-in. This house's actual equipment is a 5-ton **IDS** (split system) pairing: air handler **BIVA-60RCB-M20X** + condenser **BOVA-60RTB-M20S**. This pass fetched the real, model-size-60 Bosch documents for this exact pairing and pulled the real numbers. Everything below is sourced directly from those documents; anything that is this research's own arithmetic on top of Bosch's published numbers is labeled as such.

### Documents confirmed to match this exact model

- *Bosch IDS Premium Series Air Handler — Installation and Operating Instructions*, **BTC 762003302 C (10.2024)** — the full IOM for the BIVA air handler line (2–5 ton, R454B), fetched from `https://www.bosch-homecomfort.com/us/media/country_pool/documents/installation-manuals/bosch_ids_premium_air_handler_iom_10.2024.pdf`. This is a different, fuller document than the "Product Specifications" sheet used in the prior pass — it has the full airflow table plus the DIP-switch/wiring-diagram detail the spec sheet lacks.
- *Bosch IDS Premium Series Air Handler — Product Specifications*, BTC 762008302 A (08.2024) (already in this doc's Sources) — cross-checked against the IOM above; its Table 3 airflow numbers are **identical** to the IOM's Table 15, so both documents agree.
- *Bosch IDS Heat Pump Premium Connected Series Condensing Unit — Installation and Operating Instructions*, **BTC 762003301 C (10.2024)** — the IOM for the BOVA condenser line, fetched from `https://assets.unilogcorp.com/267/ITEM/DOC/BOSCH_BOVA60RTBM20S_Instruction_Installation_Manual.pdf` (this exact URL is for the BOVA-60RTB-M20S model specifically, not just the family).

### Nomenclature check — these documents really do describe this house's nameplate models

The air handler IOM's own nomenclature key (Figure 1) decodes the model string position-by-position. Applying it to **BIVA-60RCB-M20X**:

| Position(s) | Code | Decodes to |
|---|---|---|
| 1 (`B`) | Brand | Bosch |
| 2 (`I`) | Application | Indoor |
| 3 (`V`) | Unit Type | Vertical Discharge / Multi-position (Air Handler) |
| 4 (`A`) | Series | A Series |
| 6-7 (`60`) | Nominal Capacity | 60×1,000 BTU/H (i.e. the "Model Size 60" row in the airflow tables below) |
| 8 (`R`) | Performance | Regular Heat Pump |
| 9 (`C`) | Internet Connected | Communication Capable (IDU) |
| 10 (`B`) | Refrigerant | R454B |
| 12 (`M`) | Power Supply | 208/230V 1Ph 60Hz |
| 13-14 (`20`) | Efficiency | 20 SEER2 |
| 15 (`X`) | Compressor Type | No compressor (correct — it's an air handler) |

This confirms **BIVA-60RCB-M20X is exactly the "Model Size 60" row** in both documents' airflow tables — not an adjacent size, and not the IDP family. The condenser IOM's own model-family shorthand ("BOVA60-20") likewise confirms **BOVA-60RTB-M20S** is the size-60, 20-SEER2 member of the same BOVA/BIVA "IDS Premium Connected" R454B platform — the same product family as the air handler, not the older R410A "BVA 2.0" line.

### The real CFM-vs-ESP table for Model Size 60

From the air handler IOM (BTC 762003302 C, Table 15, p. 26 — identical to the spec sheet's Table 3, p. 7), "CFM Wet Coil Without Filter and Electric Heat," Model Size 60, all 5 speed taps, at every External Static Pressure step Bosch publishes (0 to 0.8 in. W.C.):

| Tap | 0.0" | 0.1" | 0.2" | 0.3" | 0.4" | 0.5" | 0.58" | 0.6" | 0.7" | 0.8" |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1419 | 1365 | 1311 | 1262 | 1213 | 1156 | 1060 | 1043 | 975 | 913 |
| 2 | 1603 | 1554 | 1510 | 1463 | 1419 | 1374 | 1343 | 1327 | 1233 | 1154 |
| 3 | 1788 | 1746 | 1705 | 1664 | 1619 | 1577 | 1544 | 1534 | 1493 | 1444 |
| 4 | 1951 | 1911 | 1834 | 1833 | 1795 | 1761 | 1728 | 1719 | 1678 | 1649 |
| 5 | 2087 | 2055 | 2023 | 1982 | 1941 | 1909 | 1879 | 1873 | 1837 | 1807 |

This directly answers item 1 of this pass's task: this is the real, published, model-size-60 table — not the 3-ton IDP table used previously.

### Which tap runs when Y1 and Y2 are jumpered

This is the most important correction from this pass. The prior research assumed Y1/Y2 bridging forces the blower to "whichever tap is factory/installer-configured as High Stage" — implying one fixed tap. **The real IDS Premium air handler IOM shows this is mode-dependent, not a single fixed tap.**

Figure 44 ("Indoor unit wiring diagram," IOM p. 48) includes a "DIP SWITCH SETTING" table for the SW6-1,2 dip switches, labeled "FAN SPEED TAPS." One row is explicitly labeled **"24K/36K 60K"** (i.e. it is the row that applies to model sizes 24, 36, *and 60* — including this house's unit), giving:

| Mode | Y1 or G (MIN) → Tap | Y1+Y2 or W/W1/W2 (MAX) → Tap |
|---|---|---|
| COOL | 2 | **4** |
| HEAT | 3 | **5** |

(A separate row, labeled "48K," gives different tap numbers — COOL 1/3, HEAT 2/4 — confirming the tap-to-speed mapping is itself model-size-dependent, not universal across the whole IDS Premium line. Table 15/Note 8 on IOM p. 26 says outright: "Please refer to the wiring diagram for the default fan speeds for each model.")

Section 5.1 ("Indoor Fan Motor Function," IOM p. 27) explains the logic in words: *"When there is a call for Y2, the blower motor will turn to high speed setting. When there is a call for Y1, the blower motor will turn to low speed setting... If Y1 and Y2 are jumped, the unit will only run in high stage fan speed."* Combined with the dip-switch table above, for **this house's actual Model-Size-60 unit**:

- **A jumpered single-stage thermostat call in cooling mode always asserts Y1+Y2 together → the blower runs at Tap 4.**
- **A jumpered single-stage thermostat call in heating mode always asserts Y1+Y2 together → the blower runs at Tap 5.**
- Electric heat kit operation (W/W1/W2) also forces the "MAX" column — Tap 5 — per the same table and the wiring-diagram note repeated at every thermostat-wiring figure: "Any time the electric heat elements are active, the indoor fan will run in high stage."

So "High Stage" for this unit is **not one number** — it's Tap 4 in cooling and Tap 5 in heating. Any safeguard logic keyed to "the configured High Stage tap" needs to branch on call type (cooling vs. heating/electric-heat), not treat it as a single constant.

This dip-switch table is the factory/installer configuration point (SW6-1,2) referred to in the task's question about factory-default vs. field-configurable: the "24K/36K 60K" row is the one that matches this unit's nameplate size (there is no separate size-60-only row, and no other switch position is labeled for size 60), but confirming the physical switches are actually left in that position on the installed unit (rather than moved to the "48K" row, or another position that isn't documented here at all — the table only documents 4 of the switch's possible positions) would require a field check of the physical SW6-1,2 switches inside the air handler, which this desk-research pass could not do.

The Y1/Y2 jumper itself is also now confirmed **pictorially**, not just in text, for this exact unit: the condenser IOM (BTC 762003301 C), Figure 37, "Support 1H and 1C thermostat non-communicating setup" (p. 31), shows the thermostat's single `Y` wire physically splicing into *both* the `Y1` and `Y2` terminals at the air handler terminal block — the literal jumper the prior research inferred from text alone.

### The CFM-per-ton band is confirmed IDS-specific, and heat-kit-dependent

The IOM's own airflow-table notes (Table 15, p. 26) are IDS-specific — not carried over from the IDP line — and directly answer items 3 and 4 of this pass's task:

> "2. The rated airflow of systems without electric heater kits requires between 300 and 450 cubic feet of air per minute (CFM). Specifically for 2 Ton Air Handlers, the rated airflow is 310-450 cubic feet of air per minute (CFM)."
> "3. The rated airflow of systems with electric heater kits requires between 350 and 450 cubic feet of air per minute (CFM)."

So: **yes, the same 300–450 CFM/ton band applies to the IDS line**, stated in the IDS line's own manual in near-identical language to the IDP manual — this is not an assumption carried over from the wrong product family, it's independently confirmed. The one documented exception (310–450 for 2-ton air handlers) does not apply to this house's 5-ton (Model Size 60) unit. And yes, **whether an electric heat kit is installed changes the floor** — 300 CFM/ton without one, 350 CFM/ton with one — exactly as the prior IDP-sourced research found, now confirmed in the IDS-specific document itself. This project's own record does not currently note whether this house's air handler has an electric heat kit installed; that remains to be confirmed (see Open items).

### Computed result: does High Stage stay in band across the published ESP range

This part is this research's own arithmetic on top of Bosch's published table above — not a number Bosch states directly. Using this unit's nominal size (Model Size 60 = 60,000 BTU/h = 5 tons nominal, per the nomenclature and the outdoor unit's own "5 Ton" family listing):

- **No electric heat kit (300–450 CFM/ton → 1500–2250 CFM band):** Tap 4 (cooling High Stage) stays within band across the *entire* published ESP range, 0–0.8 in. W.C. (1951 down to 1649 CFM). Tap 5 (heating High Stage) also stays within band across the entire range (2087 down to 1807 CFM).
- **With an electric heat kit (350–450 CFM/ton → 1750–2250 CFM band):** Tap 5 (heating High Stage) still stays within band across the entire published range (minimum 1807 CFM at 0.8"). **Tap 4 (cooling High Stage) falls below the 1750 CFM floor at ESP ≥ ~0.58 in. W.C.** (1728 CFM at 0.58", 1719 at 0.6", 1678 at 0.7", 1649 at 0.8" — all below 1750).

Practical implication for `topologyLimits.ts`, if this unit turns out to have an electric heat kit installed: the cooling-mode safeguard has less ESP headroom than the heating-mode one for this specific unit, because Tap 4's own published CFM curve drops below the heat-kit CFM/ton floor before Tap 5's does. This is a real, computed asymmetry between cooling and heating that a "single high-stage tap" model would have missed entirely.

### How this section supersedes the earlier 3-ton IDP example

The "2. Bosch-specific documentation (IDP Premium / IDS platform)" section and its "Real airflow-performance" subsection below use a **3-ton IDP Premium (packaged unit)** table as their worked example. That table is real and correctly sourced, but it is the wrong product family and the wrong size for this house: IDP is a self-contained packaged unit, not this house's split-system IDS pairing, and 3-ton is not this house's 5-ton unit. For this project's purposes:

- Use the **Model Size 60 table** in this section, not the 3-ton IDP table, as the input to `topologyLimits.ts`.
- Use **Tap 4 (cooling) / Tap 5 (heating)** as the jumpered-thermostat "High Stage" tap(s) for this unit, not a single generically-assumed tap.
- The qualitative conclusions elsewhere in this document that do *not* depend on the specific table (Y1/Y2 bridging being real and documented, the CFM/ton band being the governing constraint rather than a duct-closure percentage, ECM being "constant torque" rather than constant-airflow) all independently reconfirmed true for the IDS Premium line by the documents in this section, so they still stand.

## How this was gathered

Web search plus direct retrieval and full-text extraction (`pdftotext -layout`, plus `pdftoppm` page renders for the wiring-diagram figures whose dip-switch tables `pdftotext` could not reliably linearize) of primary-source PDFs: the ACCA Manual Zr ANSI review draft, three Bosch first-party documents (an IDS Premium Series air handler spec sheet, the IDP Premium Series packaged-unit installation manual, and the IDS BVA 2.0 service manual), one Bosch-distributor technical bulletin, and (this pass) the full IDS Premium Series air handler IOM (BTC 762003302 C) and the IDS Premium Connected condensing unit IOM (BTC 762003301 C) for the house's actual nameplate models, BIVA-60RCB-M20X and BOVA-60RTB-M20S. Secondary sources (contractor blogs, forum threads) were fetched only to check whether they cited a primary source for the numbers they repeat — in every case checked, they did not. No live testing against the house's actual equipment was performed; this is desk research only.

## Executive summary

- **There is no single, universally-published "safe minimum open-duct-area %" number** — not from ACCA, not from Bosch. Every primary source that discusses this frames it as **equipment-specific**: a calculation against that specific blower's own static-pressure/airflow performance data and the OEM's stated discharge-air-temperature and pressure limits, not a fixed percentage that applies "for ECM" or "for PSC" in general.
- ACCA Manual Zr (residential zoning) does publish a few **related but narrower** numeric defaults: a zone-damper minimum-stop position of **20% of design CFM**, a dump-zone/selective-throttling relief default of **15% of design blower CFM per zone**, and an excess-air/overblow limit of **30% above a zone's design CFM**. None of these is "maximum % of total duct area that may be closed" — they're about individual zone/damper behavior, not system-wide closure.
- Manual Zr's own account of blower physics is more nuanced than "PSC has a hard cutoff, ECM ramps to save itself": **riding the blower curve can put an ECM's operating point in an unapproved, over-pressure region just as it can a PSC's** — the difference is that PSC blower CFM drops as pressure rises, while true constant-airflow ECMs hold CFM (and let pressure rise) until *they* hit a limit. Manual Zr treats the OEM's own performance data as **"sole authority"** — i.e., the actual constraint is the specific blower's own published curve.
- **Direct correction to the project's working assumption**: Bosch's own spec sheets describe the Premium IDP's blower as a **"constant torque" multi-speed ECM**, and Bosch's own published CFM-vs-ESP tables show **CFM measurably dropping as static pressure rises at every one of its 5 speed taps** — not held flat. This blower does not behave like the "hold CFM, ramp RPM until a wall" ECM described in the project's background assumption; it behaves more like a stepped-speed PSC in this one specific respect (CFM falls with pressure), just with more speed steps and (per Manual Zr's general ECM description) a stronger, faster-reacting anti-stall response.
- **Y1/Y2 bridging is directly confirmed by Bosch's own documentation**, not just an installer habit: the IDS BVA 2.0 service manual states outright, "If connected to 1-Stage thermostat jump Y1 and Y2," and a Bosch-support-hosted technical bulletin for pairing an ecobee3 Lite with a Bosch IDS/M20 air handler gives the identical instruction. With Y1/Y2 bridged, the IDP Premium's own installation manual states the blower "will only run in high stage fan speed" — i.e., every call runs the blower at its single configured high-speed tap, never at the low-speed tap.
- The safety mechanism Bosch's own service documentation actually specifies for an overpressure-adjacent fault is a **refrigerant-side High Pressure Switch (HPS)**, tripping at **580 PSIG** (closing again below 435 PSIG) — a compressor discharge-pressure protection, not an air-side/duct static-pressure switch. No duct-static-pressure safety trip is documented anywhere found in Bosch's literature.
- ASHRAE's numeric duct-static-pressure standards (found in Standard 62.2 addenda) address **mechanical ventilation** duct sizing, a different system than comfort-conditioning zoning ductwork, and don't transfer directly to this question. No ASHRAE guidance specific to residential zoning duct-closure ratios was found.

## 1. General duct-closure / static-pressure guidance by blower type

### ACCA Manual Zr's own taxonomy of blower motors

Source: *ACCA Manual Zr — Residential Zoning, First Edition, Version 1.10 (ANSI Review Draft, 17 Nov 2017)*, Section 5, Figure 5-3, "Blower Motors for Zone Damper Systems" (p. 46 of the draft).

Manual Zr identifies **five** motor/control combinations, not two or three:

| Blower Motor | Adjust | Steps | Cfm behavior as pressure rises | ESP behavior | Automated control from zone system |
|---|---|---|---|---|---|
| PSC | Motor RPM | 2, 3, or 4 discrete | Drops | Rises to a balance point | Yes, via speed-change relay (must be OEM-approved) |
| ECM-OEM | Cfm tap | 3 to 12 discrete | Drops | Rises from min to max | None, or restricted — OEM sets/blocks the taps |
| ECM-ZEV | Cfm tap | Effectively infinite (PWM) | Drops | Rises from min to max | Yes — the zoning-equipment vendor controls it directly |
| VSM-OEM | Motor RPM | Effectively infinite | Drops | Rises to a balance point | None, or restricted |
| VSM-ZEV | Motor RPM | Effectively infinite | Drops | Rises to a balance point | Yes |

The table's own "Cfm" column literally says **"Drops"** for every single motor type, including every ECM and VSM variant — Manual Zr does not treat any of these as truly holding CFM flat forever; all of them lose airflow as pressure rises, they just do it via different control mechanisms and at different rates.

### What Manual Zr actually says happens as zones close

Section 5-8/5-9/5-10 (draft pp. 46–47) gives a specific, physically-argued account, not a percentage rule:

- **PSC**: "A blower with a PSC motor operating at a selected speed has a unique blower curve. If there is no air relief, the duct system operating point moves up the blower curve as zone dampers close. If this migration is excessive, the blower blades will stall. Stall can be avoided by jumping to a lower motor speed." Manual Zr's own worked example (Figures 5-6 through 5-8, using "actual OEM blower table data") shows that with two of three zones closed, "the system curve is totally incompatible with the PSC blower curve, so this is an impossible operating scenario" without either air relief or a lower blower speed. Manual Zr's explicit conclusion: **"Riding a PSC blower curve is not a viable air management strategy."**
- **VSM** (true variable-speed motor): "equivalent to PSC performance... Stall is avoided by reducing motor speed" — same mechanism as PSC, just with continuously-variable rather than stepped speed control.
- **ECM**: "the motor will speed up to maintain the set-point Cfm as zone dampers close. Since Cfm is held constant as blower pressure increases (undesirable behavior), the blower curve is a vertical line. At some point, blower speed and pressure will reach their maximum limits (unacceptable operating condition)." Manual Zr's own worked example for the *same* three-zone scenario finds that with the critical zone closed, "ECM pressure will be more than 0.90 IWC, and this might exceed a high limit value" — and with two of three zones closed, "the system curve is totally incompatible with the ECM blower curve" too, "so this is an impossible operating scenario (either provide air relief, and/or, use a lower blower Cfm setting)."

The direct, sourced conclusion: **ECM is not immune to over-closure** in Manual Zr's own analysis — it fails at a different point on the curve (a pressure/RPM ceiling instead of a stall), but it fails. Manual Zr's fix for both motor types is the same: **use OEM performance/balance-point data to pick a lower target CFM (or speed tap) as zones close, or provide air relief** — not "just let the ECM handle it."

### The numeric anchors Manual Zr actually publishes

These are the only genuinely numeric, generally-applicable defaults found in the draft, and none of them is "% of total duct area closed":

| Concept | Value | Source location | What it actually governs |
|---|---|---|---|
| Damper stop (minimum position) | **20% (0.20 factor) of that damper's own design CFM**, "can be less than 20%" | Section N2-8, "Damper Stop Worksheet" | The floor a single zone damper is allowed to close *to* — not the whole-system closure ratio. Applies per-zone, and only to zones with design CFM ≥ 200 CFM. |
| Dump-zone relief (default) | **15% of design blower CFM** | Section N2-10 | How much air gets routed to a designated non-priority "dump" zone as relief, not a closure limit. |
| Selective-throttling comfort-zone overblow (default) | **15% of max blower CFM per zone** (30% if overblowing two zones simultaneously) | Section N2-12 | Same idea as above for capacity-controlled ("selective throttling") systems; explicitly overridden by OEM's own rule if the OEM specifies one. |
| Zone-damper excess-air / overblow limit | **30% above a zone's design CFM** | Sections N2-9/N2-16 | Caps how much *extra* air a zone can receive as air is relieved elsewhere — the flip side of closure, not closure itself. |
| Bypass-air factor (BPF) | Not a fixed % — an equation solved per install | Figure N2-2, Section 7 | The actual "how much can be diverted/closed off" answer for a bypass-duct system; it's a formula using the OEM's low/high-limit discharge-air temperatures, entering-air temperature, and the blower's own B/C (BTU-per-CFM) rating — output varies by equipment, climate, and even by which heating/cooling stage is active. |

### What Manual Zr deliberately does NOT publish

There is no line in this draft that reads anything like "do not close more than X% of the ductwork" as a general residential rule. The manual's own glossary entry for "Sole Authority" (draft glossary, S-section) defines it as **"the product manufacturer... This can be an original equipment manufacturer (OEM), or a zoning equipment vendor (ZEV)"** — i.e., Manual Zr's own stance is that the equipment manufacturer's performance data and limits, not an ACCA-wide number, are the actual governing authority for any specific installation. Section N2-13 reinforces this directly: for staged or modulated equipment, "OEM expanded performance data is required for each cooling stage, and for each heating stage... Also required, are the OEM's low, and/or, high limit values for entering air temperature, leaving air temperature, and the air temperature rise... Conforming to these limits is a requirement."

## 2. Bosch-specific documentation (IDP Premium / IDS platform)

### Documents used

- *Bosch IDP Premium Series Packaged Unit — Installation and Operating Instructions*, BTC 762003316 A (12.2024). This is the closest documentary match to "Bosch Premium IDP" in the project background — a packaged (self-contained outdoor) heat pump unit. **Caveat**: the exact literal phrase "Premium IDP" (vs. the manual's own "IDP Premium") wasn't found verbatim anywhere; confirm the nameplate model number against this document family before treating it as authoritative for the house's specific unit.
- *Bosch IDS Heat Pump Premium Series Air Handler — Product Specifications*, BTC 762008302 A (08.2024) — a split-system air handler in the adjacent "IDS" (Inverter Ducted Split) product family, used here for a second, independently-published CFM-vs-ESP table.
- *Bosch IDS BVA 2.0 Service Manual* (02.2019, Bosch Thermotechnology Corp.), hosted by TSS Associates (an authorized Bosch technical-support-branded distributor, per the manual's own footer: "BoschHeatingAndCooling.com Tech Support 866-642-3198").
- A TSS Associates technical bulletin, "ecobee3 Lite – Bosch IDS – M20 Air Handler – Electric Back-Up – EWC BMPlus Panel" (2/6/2024) — a first-party-adjacent field/installation bulletin, not an official Bosch-branded document, but from the same support organization as the official service manual above.

### Blower type correction: "constant torque," not constant-airflow

Both the IDS Premium air handler spec sheet ("Constant torque multi-speed ECM blower motor - designed for two stage operation," Section 1.1) and the IDP Premium packaged-unit manual ("The ECM Constant Torque motor has 5 selectable speed taps," Section 6) describe the blower the same way: a **constant-torque** ECM, not a constant-airflow ECM. This is a real, sourced distinction from the project's background assumption ("ECM/variable-speed blowers ramp RPM in response to rising static pressure to maintain airflow"):

- A **constant-airflow** ECM (the type Manual Zr's own Section 5-9/5-10 "vertical line" description is written about) actively raises RPM specifically to hold a target CFM number flat as pressure rises, until it hits a speed/pressure ceiling.
- A **constant-torque** ECM instead holds torque roughly constant at a given commanded speed tap. Bosch's own published airflow tables (below) show CFM measurably declining as ESP rises at *every one* of the 5 taps, on *every* model size tested, in *both* Bosch documents pulled. That is closer to a (smoother, better-behaved) PSC-style pressure response than to the flat-CFM/rising-pressure-only behavior the project's background note describes.

This doesn't mean "no benefit over PSC" — Manual Zr's Figure 5-3 still credits ECM-type motors with finer-grained speed control (3–12+ steps vs. PSC's 2–4) and Bosch's own tables show a comparatively graceful, gradual CFM decline (not a stall). But it does mean the specific "ECM ramps to protect itself, so it's inherently safer to close more vents on it" framing is not supported by this equipment's own published performance data — the actual, correct thing to design against is this blower's own CFM-vs-ESP curve (see Section 3 below), not a generic "ECM = safe" assumption.

### Real airflow-performance (CFM vs. ESP) data

Both Bosch documents publish full fan-performance tables: SCFM at ESP steps from 0.0 up to 0.8 in. W.C. (IDS Premium air handler, IDS BVA 2.0) or 1.0 in. W.C. (IDP Premium packaged unit), for every speed tap (1–5) and every model size. Representative rows, IDP Premium 3-ton, all 5 taps (BTC 762003316 A, Table 17):

| Tap | SCFM @ 0.0" WC | SCFM @ 0.4" WC | SCFM @ 0.8" WC | SCFM @ 1.0" WC |
|---|---|---|---|---|
| 1 | 863 | 549 | 306 | 231 |
| 2 | 1144 | 897 | 608 | 493 |
| 3 | 1291 | 1068 | 828 | 689 |
| 4 | 1467 | 1248 | 1075 | 964 |
| 5 | 1537 | 1327 | 1115 | 971 |

The manual's own note on this table: **"Bold outlined areas represent airflow outside of the required 300-450 cfm/ton range."** — i.e., Bosch's own governing numeric constraint is a **CFM-per-ton band (300–450, or 350–450 with electric heat kits installed)**, checked against this table at whatever ESP the duct system actually presents, not a flat maximum-ESP number and not a duct-closure percentage. The table's highest published ESP step (0.8"/1.0" WC) is the top of what Bosch tested and published — the text ("stay within the minimum and maximum limits shown in the table below") implies but does not explicitly state that these are hard operating ceilings; no separate "never exceed X in. W.C." sentence was found anywhere in either document.

### Y1/Y2 bridging — confirmed, not just an installer convention

This is directly and explicitly documented, in more than one Bosch-lineage source:

- IDS BVA 2.0 Service Manual, wiring-diagram notes (Figure 23): **"1: If connected to 1-Stage thermostat jump Y1 and Y2."**
- Independently, the official Bosch-hosted (not distributor-hosted) *"Bosch IDS 2.0 — BOVA/BVA — Service Manual"* (07.2021, `bosch-homecomfort.com/us/media/country_pool/service/technical_guides/bosch_ids2.0_bova-bva_service_manual_external_rev3.pdf`), Section 10.2.3 "Two Stage Fan Control," independently confirms the same behavior in near-identical wording: *"If 2 stage thermostat is not available, single stage thermostat may be used... If Y1 and Y2 are jumped, the unit will only run in high stage fan speed."* This is a second, independently-fetched primary source (Bosch's own domain, not a third-party distributor) for the identical claim.
- IDP Premium install manual, Section 6 ("Indoor Fan Motor Function," "Two Stage Fan Control"): *"The IDP Premium supports two stage fan control which requires a two stage thermostat (Y1&Y2). When there is a call for Y2, the blower motor will turn to high speed setting. When there is a call for Y1, the blower motor will turn to low speed setting... If 2 stage thermostat is not available, single stage thermostat may be used... If Y1 and Y2 are jumped, the unit will only run in high stage fan speed."*
- TSS Associates ecobee3 Lite / Bosch IDS M20 bulletin (2/6/2024): **"If only one stage is being wired then jumper W1–W2, Y1–Y2 at air handler and adjust parameters accordingly: Set staging to Automatic and set Optimization to Maximum."**

Net effect for this house's actual configuration, confirmed by Bosch's own wording, not inferred: with Y1/Y2 bridged at the equipment (as the background states was done here), **every call for heat or cool is simultaneously a Y1-and-Y2 call**, so the blower goes straight to whichever speed tap is factory/installer-configured as the equipment's "High Stage" setting and stays there for the whole call — it never runs at the lower ("Y1 only") tap. This matters directly for the pressure safeguard: the relevant CFM-vs-ESP row to design against is specifically the **High Stage tap's own curve** (e.g., Tap 4 or 5 depending on the installed model/size and dip-switch configuration — see Table 17/18/19 in the IDP manual), not some blended or lower-speed curve.

> **Superseded for this project's actual unit** — see [This installation's actual unit](#this-installations-actual-unit-biva-60rcb-m20x-and-bova-60rtb-m20s) above: for the real installed BIVA-60RCB-M20X/BOVA-60RTB-M20S pair, "High Stage" is confirmed to be **two different taps depending on mode** (Tap 4 in cooling, Tap 5 in heating), not one fixed tap as this paragraph's generic phrasing implies.

### The actual safety trip Bosch documents: refrigerant-side HPS, not a duct-pressure switch

Both the IDP Premium install manual and the IDS BVA 2.0 service manual document a **High Pressure Switch (HPS)**: *"High Pressure Switch opens at P > 580 PSIG, the compressor and outdoor fan [shut off]... High Pressure Switch closes at P < 435 PSIG."* This is a mechanical refrigerant-circuit safety switch on the compressor discharge line — it protects against excessive **refrigerant** pressure (which restricted/starved airflow across the indoor coil can indirectly cause, by reducing heat transfer and driving up head pressure on the compressor side), not a direct measurement of **duct static pressure**. No air-side/duct static-pressure safety switch or shutdown threshold is documented anywhere in the three Bosch documents pulled. This is useful context for the project's safeguard: the failure mode Bosch's own hardware actually guards against (HPS trip) is a second-order consequence of prolonged excessive duct closure, not something the equipment detects and reacts to directly on the air side — reinforcing that the vent-side software safeguard is doing real, otherwise-unhandled protective work, not duplicating an existing equipment safety feature.

### What Bosch's own docs do NOT say

- No explicit zoning-compatibility statement, and no explicit guidance on maximum number of zones, minimum zone size, or duct-closure percentage, was found in the IDP Premium install manual, the IDS Premium air handler spec sheet, or the IDS BVA 2.0 service manual. Duct design is explicitly delegated: *"Design the duct system in accordance with 'ACCA' Manual 'D'..."* (IDP Premium manual, Section 7).
- No explicit statement recommending Y1/Y2 bridging *specifically for pairing with a third-party/non-Bosch thermostat* (e.g., ecobee) was found as its own distinct recommendation — the documented instruction is more general ("if connected to a 1-stage thermostat"), which covers the ecobee-as-single-stage case but isn't phrased as third-party-thermostat-specific guidance in Bosch's own manuals. The TSS Associates ecobee bulletin is the closest thing found to an explicit "pairing with this specific third-party thermostat" document, and it corroborates the same underlying wiring practice.

## 3. Is "stage count" the right variable, or is it the blower's own curve?

Directly addressed by the primary sources above, not left to inference: **it's the blower's own curve, and both ACCA and Bosch's own documents say so, in different words.**

- ACCA Manual Zr treats the OEM's own performance data as **"Sole Authority"** (glossary) and requires "OEM expanded performance data... for each cooling stage, and for each heating stage" (Section N2-13) before any capacity-control/staging-aware calculation can be done at all. Its own worked examples (Section 5-10) use "actual OEM blower table data," not a generic number, to show exactly where a PSC or ECM blower's operating point becomes "impossible."
- Bosch's own published constraint for the IDP Premium/IDS product lines is a **CFM-per-ton band (300–450) checked against that specific model+tap's own CFM-vs-ESP table** — not a stage-count-based rule, and not a duct-closure-percentage rule.

"Stage count" (single-stage / two-stage / variable-speed) is a reasonable **rough proxy** for how many discrete operating points a piece of equipment has and how its control logic responds to pressure (Manual Zr's Figure 5-3 table is organized exactly this way), but neither primary source treats stage count as the actual safety constraint. The safety constraint in both is: *this specific blower, at this specific commanded speed/tap, has a specific CFM-vs-ESP curve and a specific manufacturer-stated acceptable CFM range; don't push the operating point outside that range.* For this project, that means the input the pressure safeguard actually needs is the **Bosch-published CFM-vs-ESP table for the installed model/size, at whatever tap the Y1/Y2-bridged "High Stage" setting resolves to** (Table 17-equivalent for the real nameplate model) — not a hardcoded "ECM = safe to X%" constant.

## 4. ACCA Manual D / Manual Zr / ASHRAE — direct numeric guidance

- **ACCA Manual D** (duct design): Not independently retrieved as full text in this pass (it's a paid ACCA publication; only referenced *by* other documents here). Every source that mentions it — the Bosch IDP Premium install manual, the Arzel contractor guide, the ACCA HVAC blog post on bypass ducts — treats it as the source for duct **sizing** (friction loss, fitting equivalent lengths, flex-duct pressure-drop adders) rather than a source of a closure-ratio number. No claim about Manual D containing a specific "max % closed" figure could be verified; treat any such claim (if it surfaces elsewhere) as unconfirmed until Manual D itself is checked directly.
- **ACCA Manual Zr** (residential zoning): see Sections 1 and 3 above — real numeric content found and quoted directly from the draft PDF, but note this is a **1.10 "ANSI Review Draft" dated 17 Nov 2017**, not necessarily identical to the final published/purchased edition ACCA sells today. Treat section numbers and any since-revised numeric defaults as needing a final-edition cross-check if this ever needs to be defended to a code official or manufacturer rep.
- **ASHRAE**: Searched specifically for residential zoning / duct-closure static-pressure guidance. What was found (ASHRAE 62.2 addenda, e.g. the 2022 Addendum t) concerns **mechanical/whole-house ventilation** duct sizing (a 0.25 in. W.C. design-pressure floor for prescriptive ventilation duct sizing tables) — a materially different system (outdoor-air ventilation ductwork, not comfort-conditioning zoned supply ductwork) and not applicable to this question. ASHRAE 90.1 results found concerned commercial duct **seal class** by construction pressure class (a leakage/construction-quality standard), also not on point. **No ASHRAE standard or guideline specific to residential comfort-system zoning duct-closure ratios was found** — this should be treated as a confirmed "not found," not an oversight; if it exists, it likely lives in a members-only ASHRAE Handbook chapter not indexed by general web search.

## Practitioner/secondary numbers found — explicitly NOT primary-sourced

These numbers turned up repeatedly in contractor-marketing and blog content. None of them were traceable to a primary source (ACCA, ASHRAE, or an OEM) in this research pass — they're recorded here only so they aren't mistaken for sourced numbers later, and so a future pass knows they were checked and came up empty on attribution:

- **"Smallest zone should be at least 35% of total ductwork (25% for multi-stage equipment with zone weighting)"** — Arzel Zoning contractor guide (a zone-damper-equipment vendor's own marketing/how-to content). The article cites no ACCA section number or OEM source for this figure; it appears to be Arzel's own field rule of thumb.
- **"Total external static pressure should stay at or below 0.5 in. W.C. for PSC motors, 0.7 in. W.C. for ECM motors"** — this exact pairing of numbers surfaced in aggregated web-search summaries (not traced to one clearly-identified article with its own citation). Do not treat as sourced; it may be a garbled or averaged restatement of an OEM-specific spec sheet rather than a general rule.
- **General "dead-heading" framing** ("if all zone dampers close, the blower pushes against a fully blocked duct, which can damage the blower or freeze the coil") is directionally consistent with Manual Zr's own PSC/ECM stall-and-pressure-ceiling analysis (Section 1 above), but the specific percentage thresholds attached to it in blog content were not sourced to anything beyond the blog's own say-so.

## Engineering inferences for this project (not stated by any source)

These are reasonable design conclusions for `topologyLimits.ts` given everything above, but they are this research's own synthesis — **no source states them as a number to hardcode**:

> **Update from the real installed unit** — see [This installation's actual unit](#this-installations-actual-unit-biva-60rcb-m20x-and-bova-60rtb-m20s): the "one single blower operating curve" simplification below turns out to be one curve *per mode*, not one curve overall — Tap 4 in cooling, Tap 5 in heating, for the real BIVA-60RCB-M20X/BOVA-60RTB-M20S pair. The rest of this section's reasoning (steps 1-4 below) still holds; step (2) now has a real answer instead of a placeholder.

- Because Y1/Y2 is bridged, the safeguard should be designed against **one single blower operating curve** (the "High Stage" tap), not against a range of possible stage-dependent curves — this simplifies the input needed (one CFM-vs-ESP table row set, not several) but also means there is no "low stage" fallback to lean on; the blower is always at its highest configured speed whenever it runs at all.
- The genuinely defensible way to compute a safe minimum open-duct-area (or maximum closure) percentage for this specific installation is to: (1) get the actual nameplate model/size and configured speed tap from the installed equipment (not assume from generic docs), (2) pull that model+tap's real CFM-vs-ESP row from Bosch's published table (structurally identical to the Table 17 example above), (3) determine the design/full-open system CFM and ESP from the house's own duct design (ideally from the original Manual D calc, if one exists, or measured), and (4) treat the manufacturer's 300–450 CFM/ton band as the hard floor/ceiling, translating that into an implied maximum ESP for this specific unit, then back-calculating what fraction of vents can close (via the house's own duct system curve, per Manual Zr Section 5-9's method) before that ESP is reached. This is materially more work than a hardcoded percentage, but it's the only approach any primary source actually endorses.
- A conservative placeholder *shape* for the safeguard (not a specific number) that both primary sources would likely support: express the limit as **"do not let system CFM at the operating tap fall below the equipment's own published CFM/ton floor (300, or 350 if electric heat kit is installed) for its rated tonnage,"** derived from the real installed unit's own table — rather than as a flat "% of vents closed" number that ignores which specific vents (and how restrictive each already is) are involved.

## Open items / unconfirmed

1. ~~**The house's actual installed model number, tonnage, and speed-tap configuration** were not confirmed against a specific Bosch document...~~ **Resolved by this pass** — see [This installation's actual unit](#this-installations-actual-unit-biva-60rcb-m20x-and-bova-60rtb-m20s): the nameplate models are BIVA-60RCB-M20X (air handler) and BOVA-60RTB-M20S (condenser), confirmed against their own model-specific IOMs and decoded via the manufacturer's own nomenclature key. One piece remains genuinely unconfirmable from documents alone: whether the physical SW6-1,2 dip switches inside the installed air handler are actually left in the documented "24K/36K 60K" position, as opposed to having been moved — that would require a field check, not another document.
2. **No explicit Bosch statement was found recommending Y1/Y2 bridging specifically because a third-party (non-Bosch) thermostat is being used**, as opposed to "because a single-stage thermostat of any brand is being used." These may be functionally the same guidance in this case, but it's worth confirming with Bosch technical support or the installer directly if this detail matters to the project's reasoning elsewhere.
3. **No explicit maximum-ESP "do not exceed" sentence** was found in any Bosch document pulled — only the implication that the published table's highest tested ESP step (0.8"–1.0" W.C. depending on document) is the practical ceiling, and the explicit 300–450 CFM/ton constraint. Whether Bosch has a harder, more explicit ESP ceiling in an engineering/technical-data document not surfaced by this search (as opposed to the consumer-facing IOM/spec sheet) is unconfirmed.
4. **ACCA Manual D's own text was not directly retrieved** (paid publication); only its role as duct-sizing reference (via citations from other documents) is confirmed here.
5. **Whether the final, published (non-draft) edition of ACCA Manual Zr matches** the numeric defaults found in the 17 Nov 2017 ANSI review draft used here is unconfirmed — flagged above, repeated here for visibility.
6. **The `zones.maximum-static-pressure` field found (`null`) during the earlier Flair API discovery pass** (see `docs/flair-api-schema.md`) remains unexplored — worth checking whether Flair's own platform has a mechanism to set/enforce this that could complement (not replace) this project's own safeguard.
7. **No ASHRAE guidance specific to residential zoning duct-closure ratios was found** — confirmed searched, not just unexplored; see Section 4.
8. **Whether this house's air handler has an electric heat kit installed** is not recorded anywhere in this project's research. This matters for this specific unit: per [Computed result](#computed-result-does-high-stage-stay-in-band-across-the-published-esp-range), the cooling-mode High Stage tap (Tap 4) falls below the CFM/ton floor at ESP ≥ ~0.58 in. W.C. if a heat kit is installed (350 CFM/ton floor), but stays in-band across the full published range if not (300 CFM/ton floor). Worth a quick visual check of the air handler for an EHK-0xB module before finalizing any cooling-mode ESP limit.
9. **Whether the physical SW6-1,2 dip switches inside the installed BIVA-60RCB-M20X are actually set to the documented "24K/36K 60K" position** (as opposed to the "48K" position, or another undocumented position) is unconfirmed from documents alone — see the note in [Which tap runs when Y1 and Y2 are jumpered](#which-tap-runs-when-y1-and-y2-are-jumpered). This would require opening the air handler and reading the physical switches, or asking the installer.

## Sources

- [ACCA Manual Zr — Residential Zoning, First Edition, Version 1.10, ANSI Review Draft, 17 Nov 2017 (PDF)](https://higherlogicdownload.s3.amazonaws.com/ACCA/8e4cf5b4-e984-4971-bb79-7889082c7cf2/UploadedImages/Manual_Zr_Ver_1_10_review_draft_17Nov2017.pdf)
- [Bosch IDP Premium Series Packaged Unit — Installation and Operating Instructions, BTC 762003316 A (12.2024) (PDF)](https://resource.gemaire.com/is/content/Watscocom/Gemaire/bosch_idp-premium-heat-pump-package-unit_en_ii.pdf)
- [Bosch IDS Heat Pump Premium Series Air Handler — Product Specifications, BTC 762008302 A (08.2024) (PDF)](https://resource.gemaire.com/is/content/Watscocom/Gemaire/bosch_ids-premium-connected-air-handler_en_ss.pdf)
- [Bosch IDS BVA 2.0 Service Manual (02.2019, Bosch Thermotechnology Corp., hosted by TSS Associates / BoschHeatingAndCooling.com Tech Support) (PDF)](https://tssassociatesinc.com/wp-content/uploads/2023/04/New-2.0-Service-Manual.pdf)
- [TSS Associates — "ecobee3 Lite – Bosch IDS – M20 Air Handler – Electric Back-Up – EWC BMPlus Panel," 2/6/2024 (PDF)](https://tssassociatesinc.com/wp-content/uploads/2024/02/ecobee-3-Lite-IDS-M20-Air-Handler-Electric-Back-Up-EWC-BMPlus-Panel.pdf)
- [ACCA HVAC Blog — "Balancing a Zone System Bypass Duct"](https://hvac-blog.acca.org/balancing-zone-system-bypass-duct/) (referenced for what it does/doesn't cite; contains no independently-verifiable numeric guidance of its own)
- [ACCA — Manual Zr product page](https://www.acca.org/standards/technical-manuals/manual-zr) (for context on the manual's official status/purchase path)
- [Arzel Zoning — "A Contractor's Guide to Managing Static Pressure in HVAC Zoning Systems"](https://www.arzelzoning.com/a-contractors-guide-to-managing-static-pressure-in-hvac-zoning-systems/) (secondary/vendor source; numbers not independently attributed — see [Practitioner/secondary numbers](#practitionersecondary-numbers-found--explicitly-not-primary-sourced))
- [ANSI/ASHRAE Addendum t to ANSI/ASHRAE Standard 62.2-2022](https://www.ashrae.org/file%20library/technical%20resources/standards%20and%20guidelines/standards%20addenda/62_2_2022_t_20250630.pdf) (checked; concerns ventilation duct sizing, not zoning — see [Section 4](#4-acca-manual-d--manual-zr--ashrae--direct-numeric-guidance))
- [Bosch IDS Premium Series Air Handler — Installation and Operating Instructions, BTC 762003302 C (10.2024) (PDF)](https://www.bosch-homecomfort.com/us/media/country_pool/documents/installation-manuals/bosch_ids_premium_air_handler_iom_10.2024.pdf) — the IOM for this house's actual air handler (BIVA-60RCB-M20X); source for the [This installation's actual unit](#this-installations-actual-unit-biva-60rcb-m20x-and-bova-60rtb-m20s) section
- [Bosch IDS Heat Pump Premium Connected Series Condensing Unit — Installation and Operating Instructions, BTC 762003301 C (10.2024) (PDF)](https://assets.unilogcorp.com/267/ITEM/DOC/BOSCH_BOVA60RTBM20S_Instruction_Installation_Manual.pdf) — the IOM for this house's actual condenser (BOVA-60RTB-M20S)
