# Configuration Guide

This guide helps you configure Apple RAG Collector for your own use.

## Quick Start

1. Copy the configuration template:
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

2. Edit `wrangler.toml` with your own values
3. Deploy to Cloudflare Workers:
   ```bash
   pnpm run deploy
   ```

## Configuration Options

### Basic Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `name` | Your worker name | `"my-apple-rag-collector"` |
| `schedule` | Cron schedule | `"*/5 * * * *"` (every 5 minutes) |

### Database Configuration

You need a PostgreSQL database with the required schema. See [DATABASE.md](DATABASE.md) for setup instructions.

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL host | `"your-postgres-host.com"` |
| `DB_PORT` | PostgreSQL port | `"5432"` |
| `DB_NAME` | Database name | `"apple_rag_db"` |
| `DB_USER` | Database user | `"your_user"` |
| `DB_PASSWORD` | Database password | `"your_password"` |
| `DB_SSL` | Enable SSL | `"true"` or `"false"` |

### Cloudflare Workers Plan Configuration

Choose the right configuration based on your Cloudflare Workers plan:

#### Free Plan (50 subrequests/request)
```toml
BATCH_SIZE = "10"
BATCH_COUNT = "5"
# Total: 50 requests (at limit)
```

#### Paid Plan (1000 subrequests/request)  
```toml
BATCH_SIZE = "45"
BATCH_COUNT = "20"
# Total: 900 requests (safely under limit)
```

### Embedding API Configuration

Configure your preferred embedding service:

| Variable | Description | Example |
|----------|-------------|---------|
| `EMBEDDING_MODEL` | Model name | `"text-embedding-ada-002"` |
| `EMBEDDING_DIM` | Vector dimension | `"1536"` |
| `EMBEDDING_API_BASE_URL` | API endpoint | `"https://api.openai.com/v1/embeddings"` |
| `EMBEDDING_API_TIMEOUT` | Timeout (seconds) | `"30"` |

### Optional Features

#### Telegram Notifications
1. Create a Telegram bot via [@BotFather](https://t.me/botfather)
2. Get your chat ID
3. Configure the URL:
   ```toml
   TELEGRAM_BOT_URL = "https://api.telegram.org/bot{YOUR_BOT_TOKEN}/sendMessage?chat_id={YOUR_CHAT_ID}"
   ```

#### D1 Database (for API key management)
1. Create a D1 database in Cloudflare Dashboard
2. Update the binding in `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "your-d1-database"
   database_id = "your-database-id"
   ```

## Environment-Specific Configuration

### Development
- Set `LOG_LEVEL = "debug"` for detailed logging
- Use local PostgreSQL instance
- Set `DB_SSL = "false"` for local development

### Production
- Set `LOG_LEVEL = "info"` for optimal performance
- Use production PostgreSQL with SSL
- Configure proper monitoring and alerts

## Security Best Practices

1. **Never commit secrets**: Keep `wrangler.toml` in `.gitignore`
2. **Use environment variables**: For sensitive data in CI/CD
3. **Enable SSL**: Always use SSL for production databases
4. **Rotate credentials**: Regularly update database passwords and API keys
5. **Monitor usage**: Keep track of your Cloudflare Workers usage

## Troubleshooting

### Common Issues

1. **Request limit exceeded**: Reduce `BATCH_SIZE` or `BATCH_COUNT`
2. **Database connection failed**: Check credentials and network access
3. **Embedding API errors**: Verify API key and endpoint
4. **Worker timeout**: Reduce batch size for faster processing

### Getting Help

- Check the [Issues](https://github.com/your-repo/issues) page
- Review the [Architecture Documentation](ARCHITECTURE.md)
- Enable debug logging: `LOG_LEVEL = "debug"`
