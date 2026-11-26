import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { EmailAlreadyRegisteredError } from '../common/errors';
import type { User } from './user.entity';
import { UsersRepository } from './users.repository';

/**
 * Single-table design, partition key "pk" (string), no sort key, no GSIs:
 *   USER#<id>        -> the user profile
 *   EMAIL#<email>    -> { userId }  (enforces unique email via conditional write)
 *   GOOGLE#<sub>     -> { userId }  (enforces one user per Google account)
 * Writes use transactions so the profile and its lookup items stay consistent.
 */
export class DynamoDbUsersRepository extends UsersRepository {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {
    super();
  }

  async findById(id: string): Promise<User | undefined> {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: userKey(id) } }),
    );
    return Item ? fromItem(Item) : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.findViaPointer(emailKey(email));
  }

  async findByGoogleId(googleId: string): Promise<User | undefined> {
    return this.findViaPointer(googleKey(googleId));
  }

  async create(user: User): Promise<void> {
    const notExists = 'attribute_not_exists(pk)';
    const items = [
      { pk: userKey(user.id), type: 'USER', ...user },
      { pk: emailKey(user.email), type: 'EMAIL', userId: user.id },
      ...(user.googleId ? [{ pk: googleKey(user.googleId), type: 'GOOGLE', userId: user.id }] : []),
    ];
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: items.map((Item) => ({
            Put: { TableName: this.tableName, Item, ConditionExpression: notExists },
          })),
        }),
      );
    } catch (err) {
      if (isConditionFailure(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
  }

  async linkGoogle(userId: string, googleId: string, avatarUrl?: string): Promise<User> {
    const now = new Date().toISOString();
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: { pk: googleKey(googleId), type: 'GOOGLE', userId },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: { pk: userKey(userId) },
                ConditionExpression: 'attribute_exists(pk)',
                UpdateExpression:
                  'SET googleId = :g, updatedAt = :now, avatarUrl = if_not_exists(avatarUrl, :a)',
                ExpressionAttributeValues: { ':g': googleId, ':now': now, ':a': avatarUrl ?? null },
              },
            },
          ],
        }),
      );
    } catch (err) {
      if (isConditionFailure(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
    const user = await this.findById(userId);
    if (!user) throw new Error(`User ${userId} not found after linking Google account`);
    return user;
  }

  private async findViaPointer(pk: string): Promise<User | undefined> {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { pk } }));
    const userId = Item?.userId as string | undefined;
    return userId ? this.findById(userId) : undefined;
  }
}

const userKey = (id: string) => `USER#${id}`;
const emailKey = (email: string) => `EMAIL#${email}`;
const googleKey = (sub: string) => `GOOGLE#${sub}`;

function fromItem(item: Record<string, unknown>): User {
  const { pk: _pk, type: _type, ...rest } = item; // strip storage-only keys
  const user = rest as unknown as User;
  if (user.avatarUrl === null) delete user.avatarUrl;
  return user;
}

function isConditionFailure(err: unknown): boolean {
  return (
    err instanceof TransactionCanceledException &&
    (err.CancellationReasons ?? []).some((r) => r.Code === 'ConditionalCheckFailed')
  );
}
