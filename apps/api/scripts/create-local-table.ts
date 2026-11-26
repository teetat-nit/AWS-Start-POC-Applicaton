/**
 * Creates the users table in DynamoDB Local (docker compose). In AWS the table is created by CDK.
 * Usage: pnpm db:init
 */
import { CreateTableCommand, DynamoDBClient, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import { config } from 'dotenv';

config({ quiet: true });

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const tableName = process.env.USERS_TABLE_NAME || 'poc-users';

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint)) {
  console.error(`Refusing to run against ${endpoint}: this script is for DynamoDB Local only.`);
  process.exit(1);
}

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-southeast-1',
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function main(): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`Created table ${tableName} at ${endpoint}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`Table ${tableName} already exists`);
      return;
    }
    throw err;
  }
}

void main();
