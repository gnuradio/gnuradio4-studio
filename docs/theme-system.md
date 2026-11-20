# Authoring a Studio theme

A `.gr4stheme` file is a UTF-8 JSON object of up to 64 KiB. Choose a built-in
theme as a base and specify the colors you want to change. Studio inherits the
remaining colors from the base.

## Example

Save this file as `midnight.gr4stheme`. In Studio, open **Appearance**, choose
**Import Theme…**, and select **Midnight** from the **Theme** menu to apply it.

```json
{
  "schemaVersion": 1,
  "id": "community.midnight",
  "name": "Midnight",
  "author": "Community",
  "extends": "builtin.dark",
  "tokens": {
    "canvas.background": "#101722",
    "canvas.grid": "#253247",
    "block.background": "#202B3B",
    "block.text": "#F0F4FA",
    "connection.default": "#8BA7CC"
  }
}
```

To revise an installed theme, import the edited file with the same ID and
choose **Replace Theme**. To share the selected custom theme, choose **Export Theme**.

## File format

Studio accepts the following top-level fields.

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Required. Use the number `1`. |
| `id` | Required. Use 1–100 lowercase ASCII letters, digits, dots, underscores, or hyphens. Begin with a letter or digit. Studio reserves the `builtin.` prefix. |
| `name` | Required. Display name, 1–120 characters after trimming. Use plain text without control characters or angle brackets. |
| `author` | Optional. Uses the same text rules as `name`. |
| `extends` | Optional. Choose `builtin.dark` (default), `builtin.light`, `builtin.high-contrast`, or `builtin.paper`. |
| `tokens` | Required. An object containing any subset of the keys below. Use an opaque six-digit hex string such as `"#253247"` for each color. An empty object inherits every color. |

## Supported color tokens

Join the group and key with a dot. For example, `app.textSecondary` sets the
secondary text color. Spelling and capitalization matter.

| Group | Keys |
| --- | --- |
| `app` | `background`, `surface`, `control`, `hover`, `text`, `textSecondary`, `disabled`, `border`, `borderStrong`, `accent`, `accentSurface`, `selected`, `focus`, `overlay`, `shadow` |
| `canvas` | `background`, `grid`, `selection` |
| `block` | `background`, `header`, `border`, `text`, `selected`, `disabled`, `error`, `note`, `virtual` |
| `connection` | `default`, `selected`, `highlighted`, `invalid` |
| `state` | `success`, `successSurface`, `warning`, `warningSurface`, `error`, `errorSurface`, `info`, `infoSurface`, `running`, `stopped` |

## Migrating older themes

1. Rename an exported `.grtheme` file to `.gr4stheme`. Both extensions use the same JSON format.
2. Remove any `port.*` entries from `tokens` before importing. Studio assigns port colors by data type and rejects those overrides. Keep `"tokens": {}` if you removed the last entry.
3. Import the file from **Appearance** and select the theme to apply it.

Desktop Studio can still read previously installed `.grtheme` files. If both
extensions are installed for the same ID, Studio uses the `.gr4stheme` file.
