# Support Access Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

- Hanubix support never reads a firm's records unless the **owner** allows it in the app (24 hours).
- The server enforces it: `/v1/admin/support/:firm/docs` refuses outside an open window, and logs every read and refusal.
- Support reads only what is needed for the ticket; never exports or copies records; purchase rates are never shown.
- The owner sees every support look in **Privacy & security → Activity**; the monthly access review lists them.
