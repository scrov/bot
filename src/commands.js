/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */

import { KINDS, KIND_LABELS, LIMITS } from './items.js';

/** Option types, from Discord's application command reference. */
const STRING = 3;
const BOOLEAN = 5;

export const AWW_COMMAND = {
  name: 'awwww',
  description: 'Drop some cuteness on this channel.',
};

export const INVITE_COMMAND = {
  name: 'invite',
  description: 'Get an invite link to add the bot to your server',
};

export const PING_COMMAND = {
  name: 'ping',
  description: 'Check that the bot is alive',
};

export const SCROV_COMMAND = {
  name: 'scrov',
  description: 'Links to the scrov site and source',
};

export const NOTEBOOK_COMMAND = {
  name: 'notebook',
  description: 'Open your clipboard, notes, snippets, bookmarklets and macros',
};

export const SAVE_COMMAND = {
  name: 'save',
  description: 'Save text to your notebook',
  options: [
    {
      type: STRING,
      name: 'kind',
      description: 'What to save it as',
      required: true,
      choices: KINDS.map((kind) => ({ name: KIND_LABELS[kind], value: kind })),
    },
    {
      type: STRING,
      name: 'text',
      description: 'The text to save',
      required: true,
      max_length: 4000,
    },
    {
      type: STRING,
      name: 'title',
      description: 'A name to find it by',
      required: false,
      max_length: LIMITS.title,
    },
  ],
};

export const PASTE_COMMAND = {
  name: 'paste',
  description: 'Post one of your saved items in this channel',
  options: [
    {
      type: STRING,
      name: 'item',
      description: 'Start typing its title',
      required: true,
      autocomplete: true,
    },
    {
      type: BOOLEAN,
      name: 'private',
      description: 'Show it only to you',
      required: false,
    },
  ],
};

export const HELP_COMMAND = {
  name: 'help',
  description: "List the bot's commands",
};

/** Every command, in the order they are registered and listed by /help. */
export const ALL_COMMANDS = [
  AWW_COMMAND,
  INVITE_COMMAND,
  PING_COMMAND,
  SCROV_COMMAND,
  NOTEBOOK_COMMAND,
  SAVE_COMMAND,
  PASTE_COMMAND,
  HELP_COMMAND,
];
