import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "discord.js";

import { parseMatchMessage } from "./messages";

const BOT_ID = "999999999999999999";
const NICO_ID = "111111111111111111";
const TV_ID = "795988488846573590";
const ALICE_ID = "222222222222222222";
const BOB_ID = "333333333333333333";

type MockMember = {
  id: string;
  displayName: string;
  user: {
    username: string;
    globalName: string | null;
  };
};

class MockMemberCollection {
  constructor(private readonly values: MockMember[]) {}

  get size(): number {
    return this.values.length;
  }

  first(): MockMember | undefined {
    return this.values[0];
  }

  filter(predicate: (member: MockMember) => boolean): MockMemberCollection {
    return new MockMemberCollection(this.values.filter(predicate));
  }
}

function member(id: string, displayName: string, username = displayName): MockMember {
  return {
    id,
    displayName,
    user: {
      username,
      globalName: displayName
    }
  };
}

function message(content: string, members: MockMember[] = []): Message {
  const collection = new MockMemberCollection(members);

  return {
    content,
    guild: {
      members: {
        cache: collection,
        search: async () => collection,
        fetch: async () => collection
      }
    }
  } as unknown as Message;
}

test("parseMatchMessage accepts two Discord mentions without a game", async () => {
  const parsed = await parseMatchMessage(
    message(`<@${BOT_ID}> <@${ALICE_ID}> vs <@${BOB_ID}>`),
    BOT_ID
  );

  assert.deepEqual(parsed, {
    player1Id: ALICE_ID,
    player2Id: BOB_ID
  });
});

test("parseMatchMessage extracts a trailing game after a Discord ID", async () => {
  const parsed = await parseMatchMessage(
    message(`<@!${BOT_ID}> <@${NICO_ID}> vs ${TV_ID} 40k`),
    BOT_ID
  );

  assert.deepEqual(parsed, {
    player1Id: NICO_ID,
    player2Id: TV_ID,
    gameInput: "40k"
  });
});

test("parseMatchMessage resolves exact server display names", async () => {
  const parsed = await parseMatchMessage(
    message(`<@${BOT_ID}> @KRG-23://Nico contre Télé 7 jours`, [
      member(NICO_ID, "KRG-23://Nico", "Nico"),
      member(TV_ID, "Télé 7 jours", "tele7jours")
    ]),
    BOT_ID
  );

  assert.deepEqual(parsed, {
    player1Id: NICO_ID,
    player2Id: TV_ID
  });
});

test("parseMatchMessage rejects ambiguous exact server display names", async () => {
  const parsed = await parseMatchMessage(
    message(`<@${BOT_ID}> Alex vs Bob`, [
      member(ALICE_ID, "Alex"),
      member(BOB_ID, "Alex"),
      member("444444444444444444", "Bob")
    ]),
    BOT_ID
  );

  assert.equal(parsed, null);
});
