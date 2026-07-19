# UI (React)

Vite + React 19 + React Router + TanStack Query.

```
src/
  app/           providers, router
  features/      shell, auth, home, org, sales, crm
  shared/        api client, ui, styles
```

```bash
npm ci
npm run dev      # :5173, proxy /api → :3101
npm run build    # → ../public
```

Новые экраны — в `features/<domain>/`. Склад/закупки пока через `/legacy.html`.
