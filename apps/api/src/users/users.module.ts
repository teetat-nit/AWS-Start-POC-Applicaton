import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DynamoDbUsersRepository } from './dynamodb-users.repository';
import { InMemoryUsersRepository } from './in-memory-users.repository';
import { UsersRepository } from './users.repository';

@Module({
  providers: [
    {
      provide: UsersRepository,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): UsersRepository => {
        const logger = new Logger('UsersModule');
        if (config.db.driver === 'memory') {
          logger.warn('Using in-memory user store: data is lost on restart (local dev only)');
          return new InMemoryUsersRepository();
        }
        const client = new DynamoDBClient({
          region: config.db.region,
          endpoint: config.db.endpoint,
          // DynamoDB Local accepts any credentials. In AWS the ECS task role is used (default chain).
          ...(config.db.endpoint
            ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
            : {}),
        });
        const doc = DynamoDBDocumentClient.from(client, {
          marshallOptions: { removeUndefinedValues: true },
        });
        return new DynamoDbUsersRepository(doc, config.db.usersTableName);
      },
    },
  ],
  exports: [UsersRepository],
})
export class UsersModule {}
