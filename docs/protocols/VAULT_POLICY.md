# Vault policy

## Eligibility criteria

- Vault entries must originate from approved memory sources.
- Only material that requires durable retention should be sealed.
- Entries must be attributable to a specific session and trigger.

## Local user promotion only

- Vault entries are sealed only by an explicit local user action.
- Automated or remote promotions are not allowed.

## Allowed types

- ThreadBorn
- BridgeThread
- Labyrinth

## Sealed entry immutability

- Sealed entries are immutable.
- Never edit or overwrite a sealed entry.
