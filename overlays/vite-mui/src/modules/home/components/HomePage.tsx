'use client';

import Typography from '@mui/material/Typography';

/**
 * The home page: the one screen this template ships, rendered with MUI's
 * `Typography`.
 */
export function HomePage() {
  return (
    <main className="page">
      <Typography variant="h3" component="h1" color="primary">
        Welcome
      </Typography>
    </main>
  );
}
