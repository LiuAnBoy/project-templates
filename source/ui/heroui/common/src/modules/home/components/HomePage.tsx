'use client';

import { Card } from '@heroui/react';

/**
 * The home page: the one screen this template ships, rendered with HeroUI's
 * `Card`. `text-2xl` is a Tailwind utility.
 */
export function HomePage() {
  return (
    <main className="page">
      <Card>
        <Card.Header>
          <Card.Title className="text-2xl">Welcome</Card.Title>
        </Card.Header>
      </Card>
    </main>
  );
}
