#!/bin/sh
//bin/true; exec deno run -A "$0" "$@"
import { readLines } from 'https://deno.land/std@0.178.0/io/mod.ts';
import { Keydb } from 'https://deno.land/x/keydb@1.0.0/sqlite.ts';

const IP_WHITELIST = (Deno.env.get('IP_WHITELIST') || '').split(',');

const RATE_LIMIT_INTERVAL = Number(Deno.env.get('RATE_LIMIT_INTERVAL') || 60000);
const RATE_LIMIT_MAX = Number(Deno.env.get('RATE_LIMIT_MAX') || 10);

interface InputMessage {
  type: 'new' | 'lookback';
  event: Event;
  receivedAt: number;
  sourceType: 'IP4' | 'IP6' | 'Import' | 'Stream' | 'Sync';
  sourceInfo: string;
}

interface OutputMessage {
  id: string;
  action: 'accept' | 'reject' | 'shadowReject';
  msg: string;
}

interface Event {
  id: string;
  sig: string;
  kind: number;
  tags: string[][];
  pubkey: string;
  content: string;
  created_at: number;
}

async function handleMessage(msg: InputMessage): Promise<OutputMessage> {
  if ((msg.sourceType === 'IP4' || msg.sourceType === 'IP6') && !IP_WHITELIST.includes(msg.sourceInfo)) {
    const db = new Keydb('sqlite:///tmp/strfry-rate-limit-policy.sqlite3');
    const count = await db.get<number>(msg.sourceInfo) || 0;
    await db.set(msg.sourceInfo, count + 1, RATE_LIMIT_INTERVAL);
  
    if (count >= RATE_LIMIT_MAX) {
      return {
        id: msg.event.id,
        action: 'reject',
        msg: 'Rate-limited.',
      };
    }
  }

  return {
    id: msg.event.id,
    action: 'accept',
    msg: '',
  };
}

for await (const line of readLines(Deno.stdin)) {
  console.log(JSON.stringify(await handleMessage(JSON.parse(line))));
}