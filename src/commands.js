/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */

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
  HELP_COMMAND,
];
