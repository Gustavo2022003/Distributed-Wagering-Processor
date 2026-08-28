#!/bin/bash
set -euo pipefail

echo "Criando filas SQS no LocalStack..."

awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "{
    \"FifoQueue\": \"true\",
    \"ContentBasedDeduplication\": \"false\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"
  }"

# Fila de outbox — onde o publisher worker publica os eventos.
# FIFO pra preservar ordem por aggregateId; ContentBasedDeduplication off
# porque o eventId (dedup) vem do payload, não do body hash.
awslocal sqs create-queue \
  --queue-name wager-outbox.fifo \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "false"
  }'

echo "Filas criadas:"
awslocal sqs list-queues
