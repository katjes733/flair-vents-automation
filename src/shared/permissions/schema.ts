// Pure structural schema — no permission values live here. Every field is
// optional, recursively, to any depth. A leaf's TYPE (AccessLevel) declares
// what kind of value can go there; a concrete profile object (see
// profile.ts) is what actually assigns one. Enumerated against this app's
// own real UI (NavMenu.tsx's six pages, the real dashboard dialogs), not
// invented placeholders — ported architecture, not content, from
// tesla-powerwall-automation's own ActionSchema.

export type AccessLevel = "none" | "read" | "write";

export interface ActionSchema {
  dashboard?: {
    access?: AccessLevel;
    airHandler?: {
      access?: AccessLevel;
      create?: AccessLevel; // AddAirHandlerDialog
      edit?: AccessLevel; // EditAirHandlerDialog
      delete?: AccessLevel;
      syncZones?: AccessLevel; // SyncZonesDialog / sync.ts routes
    };
    zone?: {
      access?: AccessLevel;
      create?: AccessLevel; // AddZoneDialog
      edit?: AccessLevel; // ZoneDetailDialog
      delete?: AccessLevel;
      override?: {
        // ZoneOverrideDialog — per-zone manual hold
        access?: AccessLevel;
        create?: AccessLevel;
        revoke?: AccessLevel;
      };
    };
    controlDisarm?: {
      // GlobalStatusBar — whole-installation kill switch
      access?: AccessLevel;
      disarm?: AccessLevel;
      rearm?: AccessLevel;
    };
    triggerTick?: AccessLevel;
  };

  schedules?: {
    access?: AccessLevel;
    create?: AccessLevel;
    edit?: AccessLevel;
    delete?: AccessLevel;
    dialog?: {
      eventEditor?: { access?: AccessLevel; save?: AccessLevel };
      zonePriorityList?: AccessLevel;
    };
  };

  diagnostics?: { access?: AccessLevel }; // read-only surface today
  telemetry?: { access?: AccessLevel }; // read-only surface today
  settings?: { access?: AccessLevel; write?: AccessLevel };
  systemParameters?: { access?: AccessLevel; write?: AccessLevel };
  flairConnection?: { access?: AccessLevel; reauthorize?: AccessLevel };

  installationAdmin?: {
    // schema slot reserved now, routes not built yet — see the SaaS
    // Transformation plan's "Delegate and Multi-User Access" section.
    access?: AccessLevel;
    inviteMember?: AccessLevel;
    updateMember?: AccessLevel;
    revokeMember?: AccessLevel;
  };

  // Managing your own passkeys is a personal-account-security action, not
  // an installation permission — every profile gets full access to it,
  // mirroring tesla-powerwall-automation's own `account.access` treatment.
  account?: { access?: AccessLevel };
}

// Recursive dotted-path union over the schema — "dashboard.zone.override.create" |
// "schedules.dialog.eventEditor.save" | ... — works at any depth, no cap.
// NonNullable<> strips the `| undefined` every optional property carries
// before checking/recursing.
type ActionKeysOf<T, Prefix extends string = ""> = {
  [K in keyof T & string]: NonNullable<T[K]> extends AccessLevel
    ? `${Prefix}${K}`
    : ActionKeysOf<NonNullable<T[K]>, `${Prefix}${K}.`>;
}[keyof T & string];

export type ActionKey = ActionKeysOf<ActionSchema>;
