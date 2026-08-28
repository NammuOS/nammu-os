import { POST as runSync } from './run/route';

export async function POST() {
  return runSync();
}

export async function GET() {
  return runSync();
}
