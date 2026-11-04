import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Join class names and resolve conflicting Tailwind utilities, the later one
 * winning. The only way to build a class string conditionally.
 *
 * @param inputs Class names, arrays, or objects of name to condition.
 * @returns The merged class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
