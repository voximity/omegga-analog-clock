import OmeggaPlugin, {
  OL,
  PS,
  PC,
  OmeggaPlayer,
  KnownComponents,
  Components,
  Vector,
} from 'omegga';

const {
  chat: { yellow, cyan, code, bold, italic },
  uuid: { random: randomUuid },
} = OMEGGA_UTIL;

type ClockHand = {
  id: string;
  uuid: string;
  origin: [number, number, number];
  type: 'h' | 'm' | 's';
  pickup: keyof typeof KNOWN_HANDS;
  radius: number;
  facing: number;
  position?: Vector;
  rotated?: boolean;
  hoursOffset?: number;
};

const KNOWN_HANDS: Record<string, { height: number }> = {
  Spatha: { height: 44 },
  Zweihander: { height: 72 },
  Ikakalaka: { height: 41 },
  ArmingSword: { height: 45 },
  Longsword: { height: 56 },
  HoloBlade: { height: 29 },
  ChargedLongsword: { height: 76 },
  CrystalKalis: { height: 53 },
};

const DEFAULT_ITEM_SPAWN: Partial<
  Components<KnownComponents>['BCD_ItemSpawn']
> = {
  bPickupEnabled: true,
  bPickupRespawnOnMinigameReset: false,
  PickupMinigameResetRespawnDelay: 0,
  bPickupAutoDisableOnPickup: true,
  PickupRespawnTime: 5,
  PickupOffsetDistance: 0,
  bPickupAnimationEnabled: false,
  PickupAnimationAxis: 2,
  bPickupAnimationAxisLocal: false,
  PickupSpinSpeed: 0.2,
  PickupBobSpeed: 0.1,
  PickupBobHeight: 4,
  PickupAnimationPhase: 0.9592,
};

type Config = {
  ['authed-roles']: string[];
  ['update-rate-seconds']: number;
  ['update-rate-minutes']: number;
  ['update-rate-hours']: number;
};

type Storage = { hands: Record<string, Omit<ClockHand, 'position'>> };

type PlayerTransform = {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
};

async function getPlayerTransform(player: string): Promise<PlayerTransform> {
  const match = await Omegga.watchLogChunk(
    `Chat.Command /GetTransform "${player}"`,
    /Transform: X=(-?[0-9,.]+) Y=(-?[0-9,.]+) Z=(-?[0-9,.]+) Roll=(-?[0-9,.]+) Pitch=(-?[0-9,.]+) Yaw=(-?[0-9,.]+)/,
    { first: (match) => match[0].startsWith('Transform:'), timeoutDelay: 1000 }
  );

  const result = {
    x: match[0][1],
    y: match[0][2],
    z: match[0][3],
    roll: match[0][4],
    pitch: match[0][5],
    yaw: match[0][6],
  };

  return Object.fromEntries(
    Object.entries(result).map(([k, n]) => [k, parseFloat(n.replace(',', ''))])
  ) as PlayerTransform;
}

/** Consumes a number of degrees, returns the facing value, 0<=n<4 where 0 is x+, 1 is x-, etc. */
function getFacingYaw(yaw: number): number {
  if (-45 <= yaw && yaw < 45) return 0;
  else if ((-180 <= yaw && yaw < -135) || (135 <= yaw && yaw < 180)) return 1;
  else if (45 <= yaw && yaw < 135) return 2;
  else if (-135 <= yaw && yaw < -45) return 3;
  return -1;
}

const facingRotYNormal = [90, -90, 180, 0];
const facingRotYRotated = [180, 0, -90, 90];
const facingPosX = [0, 0, 1, -1];
const facingPosY = [-1, 1, 0, 0];

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  promises: Record<string, (...args: string[]) => void> = {};
  hands: Storage['hands'] = {};
  frozen: boolean = false;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  hasAuth = (user: OmeggaPlayer | string) => {
    const p = typeof user === 'string' ? this.omegga.getPlayer(user) : user;

    return (
      p.isHost() ||
      p.getRoles().some((r) => this.config['authed-roles'].includes(r))
    );
  };

  createUserPromise = (user: OmeggaPlayer | string): Promise<string[]> => {
    const id =
      typeof user === 'string' ? this.omegga.getPlayer(user).id : user.id;

    if (id in this.promises) throw 'User already has active promise';

    return new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        delete this.promises[id];
        reject('timed_out');
      }, 30_000);

      this.promises[id] = (...data: string[]) => {
        clearTimeout(timeout);
        delete this.promises[id];
        resolve(data);
      };
    });
  };

  updateHand = async (hand: ClockHand): Promise<void> => {
    if (hand.position) {
      this.omegga.clearRegion({ center: hand.position, extent: [1, 1, 1] });
    } else {
      this.omegga.clearBricks(hand.uuid, true);
    }

    const date = new Date();
    if (hand.hoursOffset !== undefined)
      date.setHours(date.getHours() + hand.hoursOffset);

    // determine the value (from 0 to 1) that we are trying to set the hand to
    let value = 0;
    if (hand.type === 'h') {
      value = ((date.getHours() + date.getMinutes() / 60) % 12) / 12;
    } else if (hand.type === 'm') {
      value = (date.getMinutes() + date.getSeconds() / 60) / 60;
    } else if (hand.type === 's') {
      value = (date.getSeconds() + date.getMilliseconds() / 1000) / 60;
    }

    const cos = Math.cos(value * Math.PI * 2);
    const sin = Math.sin(value * Math.PI * 2);
    const hr = hand.radius * 5;
    const angle = (value > 0.5 ? value - 1 : value) * 360;

    const handData = KNOWN_HANDS[hand.pickup];
    const position = [
      hand.origin[0] + sin * facingPosX[hand.facing] * hr,
      hand.origin[1] + sin * facingPosY[hand.facing] * hr,
      hand.origin[2] + cos * hr,
    ].map(Math.round) as [number, number, number];
    hand.position = position;

    this.omegga.loadSaveData(
      {
        brick_assets: ['PB_DefaultMicroBrick'],
        brick_owners: [
          { name: 'Analog Clock ' + hand.id, id: hand.uuid, bricks: 1 },
        ],
        bricks: [
          {
            position,
            size: [1, 1, 1],
            asset_name_index: 0,
            owner_index: 1,
            color: [0, 0, 0],
            visibility: false,
            collision: { player: false },
            components: {
              BCD_ItemSpawn: {
                ...DEFAULT_ITEM_SPAWN,
                PickupClass: 'BP_ItemPickup_' + hand.pickup,
                PickupOffsetDirection: hand.facing,
                PickupOffsetDistance: 0,
                PickupRotation: hand.rotated
                  ? [0, facingRotYRotated[hand.facing], angle]
                  : [angle, facingRotYNormal[hand.facing], 0],
                PickupScale: hand.radius / (handData.height / 10),
              } as Components<KnownComponents>['BCD_ItemSpawn'],
            },
          },
        ],
      },
      { quiet: true }
    );
  };

  saveHands = async () => {
    await this.store.set('hands', this.hands);
  };

  async init() {
    // load initial state
    this.hands = (await this.store.get('hands')) ?? {};

    for (const hand of Object.values(this.hands)) {
      this.omegga.clearBricks(hand.uuid, true);
    }

    const {
      ['update-rate-seconds']: rateS,
      ['update-rate-minutes']: rateM,
      ['update-rate-hours']: rateH,
    } = this.config;

    const rate = Math.min(rateS, rateM, rateH);

    const updateHands = (s: boolean, m: boolean, h: boolean) => {
      for (const id in this.hands) {
        const hand = this.hands[id];

        if (
          (hand.type === 's' && s) ||
          (hand.type === 'm' && m) ||
          (hand.type === 'h' && h)
        ) {
          this.updateHand(hand);
        }
      }
    };

    let sc = 0,
      sm = 0,
      sh = 0;

    updateHands(true, true, true);
    setInterval(() => {
      sc = Math.min(sc + rate, rateS);
      sm = Math.min(sm + rate, rateM);
      sh = Math.min(sh + rate, rateH);

      if (this.frozen) return;

      const updateSeconds = sc >= rateS;
      const updateMinutes = sm >= rateM;
      const updateHours = sh >= rateH;

      if (updateSeconds) sc = 0;
      if (updateMinutes) sm = 0;
      if (updateHours) sh = 0;

      updateHands(updateSeconds, updateMinutes, updateHours);
    }, rate);

    this.omegga.on('cmd:clock', async (speaker: string, ...args) => {
      const player = this.omegga.getPlayer(speaker);
      if (!this.hasAuth(player)) return;

      player.getTemplateBoundsData;

      const say = (...messages: string[]) =>
        this.omegga.whisper(player, ...messages);

      try {
        const getResponse = async (): Promise<string[]> => {
          const response = await this.createUserPromise(player);
          say(
            `<size="12"><color="888888">=> </>/clock ${cyan(
              response.join(' ')
            )}</>`
          );
          if (response[0] === 'cancel') throw 'cancelled';

          return response;
        };

        const getAndValidateResponse = async <T>(
          validate: (response: string[]) => string
        ): Promise<string[]> => {
          while (true) {
            const response = await getResponse();
            const error = validate(response);
            if (!error) return response;
            say(error);
          }
        };

        if (player.id in this.promises) {
          this.promises[player.id](...args);
          return;
        }

        const subcommand = args[0];
        if (subcommand === 'new') {
          say(
            `Welcome to the ${bold(
              yellow('clock setup wizard')
            )}. To cancel at any time, use ${code('/clock cancel')}.`
          );

          // get clock ID
          say(
            `Choose a ${yellow('unique clock ID')}. Confirm with ${code(
              '/clock my-unique-ID'
            )}.`
          );

          const [id] = await getAndValidateResponse((r) => {
            if (r.length === 0)
              return `Please specify a ${yellow('unique clock ID')}.`;
            if (r.length > 1)
              return `Ensure your ${yellow('unique clock ID')} has no spaces.`;
            if (r[0] in this.hands)
              return `That ID is taken. Please choose one that is unique.`;
          });

          // get clock hand type (h/m/s)
          say(
            `Will this clock represent ${yellow('hours')}, ${yellow(
              'minutes'
            )}, or ${yellow('seconds')}? Confirm like ${code('/clock hours')}.`
          );
          const [type] = await getAndValidateResponse((r) => {
            if (!['h', 'm', 's'].includes(r[0]?.slice(0, 1))) {
              return `Please choose only one of ${yellow('hours')}, ${yellow(
                'minutes'
              )}, or ${yellow('seconds')}.`;
            }
          });

          // get clock hand model
          const knownHands = Object.keys(KNOWN_HANDS).map(yellow).join(', ');
          say(
            `Now choose a ${yellow('hand model')} for your ${cyan(
              'clock'
            )} from one of these options:`
          );
          say('- ' + knownHands);
          say(`Confirm with ${code('/clock MyModel')}.`);

          const [pickupRaw] = await getAndValidateResponse((r) => {
            const h = r.join(' ').toLowerCase();
            if (
              !Object.keys(KNOWN_HANDS)
                .map((n) => n.toLowerCase())
                .includes(h)
            ) {
              return `Ensure the ${yellow(
                'hand model'
              )} you specify is from one of these options:\n- ${knownHands}`;
            }
          });

          const pickup = Object.keys(KNOWN_HANDS).find(
            (h) => h.toLowerCase() === pickupRaw.toLowerCase()
          );

          // get clock rotated
          say(
            `Should this ${cyan(
              'clock'
            )} be rotated so that it is on its side, ` +
              `rather than flat to the back of the clock?`
          );
          say(`Specify ${yellow('yes')} or ${yellow('no')}.`);
          const [rotatedRaw] = await getAndValidateResponse((r) => {
            if (r[0] !== 'yes' && r[0] !== 'no') {
              return `Please specify ${yellow('yes')} or ${yellow(
                'no'
              )} for the clock's rotation property.`;
            }
          });

          const rotated = rotatedRaw === 'yes';

          // get hand radius
          say(
            `Now choose a ${yellow(
              'clock radius'
            )} in studs. This will be the length of your ${cyan(
              'clock hand'
            )}. Confirm like ${code('/clock 5')}.`
          );

          const [radiusAsString] = await getAndValidateResponse((r) => {
            if (!Number(r[0])) {
              return `Please pass a valid number for your ${yellow(
                'clock radius'
              )}.`;
            }
          });
          const radius = Number(radiusAsString);

          // prompt for origin and facing value now
          say(
            `Now, position this ${yellow(
              'block'
            )} where you would like the ${cyan(
              'center'
            )} of this clock hand to go.`
          );
          say(
            `The ${cyan('clock')} will be ${yellow(
              'facing you'
            )} when you confirm your selection.`
          );
          say(`To confirm your selection, run ${cyan('/clock')} again.`);

          player.loadSaveData({
            brick_assets: ['PB_DefaultMicroBrick'],
            brick_owners: [{ id: player.id, name: player.name, bricks: 1 }],
            bricks: [
              {
                position: (await player.getPosition()).map(Math.round) as [
                  number,
                  number,
                  number
                ],
                size: [1, 1, 1],
                color: [255, 255, 255],
                asset_name_index: 0,
                owner_index: 1,
              },
            ],
          });

          // await user confirmation
          await getResponse();

          const transform = await getPlayerTransform(player.name);
          const facing = getFacingYaw(
            transform.yaw <= 0 ? transform.yaw + 180 : transform.yaw - 180
          );
          const ghostBrick = await player.getGhostBrick();
          const clock: ClockHand = {
            id,
            uuid: randomUuid(),
            origin: ghostBrick.location as [number, number, number],
            type: type.slice(0, 1) as 'h' | 'm' | 's',
            pickup,
            radius,
            facing,
            rotated,
          };

          this.hands[id] = clock;
          await this.saveHands();
          say(`Created new ${cyan('clock')} with ID ${code(id)}.`);
        } else if (subcommand === 'delete') {
          let target = args[1];
          if (!target) {
            say(
              `Use ${cyan('/clock')} ${yellow(
                'clock-ID'
              )} to specify what clock to delete.`
            );
            const response = await getAndValidateResponse((r) => {
              if (!(r[0] in this.hands))
                return `Please specify a valid ${yellow('clock ID')}.`;
            });

            target = response[0];
          }

          if (!(target in this.hands)) return;

          say(
            `Are you sure you want to delete that ${cyan('clock')}? Use ${cyan(
              '/clock'
            )} ${yellow('yes')} to confirm.`
          );
          const response = await getResponse();
          if (!response[0]?.toLowerCase().startsWith('y')) {
            say('Operation cancelled.');
            return;
          }

          delete this.hands[target];
          await this.saveHands();

          say(`Successfully deleted clock hand ${yellow(target)}.`);
        } else if (subcommand === 'freeze') {
          this.frozen = !this.frozen;
          if (this.frozen) {
            say(`All ${cyan('clocks')} have been frozen.`);
          } else {
            say(`All ${cyan('clocks')} have been... thawed?`);
          }
        } else if (subcommand === 'list' || subcommand === 'ls') {
          say(`List of ${cyan('clocks')}:`);
          for (const id in this.hands) {
            say(`- ${yellow(id)} at ${code(this.hands[id].origin.join(', '))}`);
          }
        } else if (subcommand === 'offset') {
          let target = args[1];
          if (!target || !(target in this.hands)) {
            say(
              `Use ${cyan('/clock')} ${yellow(
                'clock-ID'
              )} to specify what clock to set the timezone offset of.`
            );
            const response = await getAndValidateResponse((r) => {
              if (!(r[0] in this.hands))
                return `Please specify a valid ${yellow('clock ID')}.`;
            });

            target = response[0];
          }

          let value = Number(args[2]);
          if (isNaN(value)) {
            say(
              `Use ${cyan('/clock')} ${yellow('offset-number')} (like ${cyan(
                '/clock'
              )} ${yellow('-1')}) to set the hour offset for this clock hand.`
            );
            say(
              `In the example given, ${yellow(
                '-1'
              )} would set the clock 1 hour ${bold('behind')}.`
            );

            const response = await getAndValidateResponse((r) => {
              const num = Number(r[0]);
              if (isNaN(num) || num > 12 || num < -12)
                return `Please specify a valid ${yellow(
                  'hour offset'
                )} as a number.`;
            });

            value = Number(response[0]);
          }

          this.hands[target].hoursOffset = value;
          await this.saveHands();
          say(
            `Set ${cyan(target)}'s ${yellow('hour offset')} to ${bold(
              value.toString()
            )}.`
          );
        }
      } catch (e) {
        console.error(e);

        if (e === 'timed_out') {
          say(italic('Timed out waiting for response. Operation cancelled.'));
        } else if (e === 'cancelled') {
          say(italic('Operation cancelled.'));
        }
      }
    });

    return { registeredCommands: ['clock'] };
  }

  async stop() {
    // Anything that needs to be cleaned up...
  }
}
