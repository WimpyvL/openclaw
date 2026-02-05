# Vault Policy

## Purpose

The Vault is for irreversible, identity-level milestones that must remain sealed and auditable. Vault entries are append-only and never edited after sealing.

## Qualifying events

Vault sealing is reserved for:

- Identity events (core identity shifts, bindings, or commitments).
- Revelations that permanently change the system or user relationship.
- Irreversible transformations that cannot be safely rolled back.

## Promotion authority

- Only the local user can promote content into the Vault.
- No automated agent or scheduled process may seal entries.

## When sealing is allowed

- Sealing is allowed only by explicit manual intent.
- Automatic triggers or background tasks must never seal Vault entries.

## Allowed source memory types

Vault entries may be sealed only from:

- ThreadBorn
- BridgeThread
- Labyrinth

## Write only guarantee

- The Vault is write-only and append-only.
- Never edit or delete Vault entries.
- New information must be appended by explicit command.
