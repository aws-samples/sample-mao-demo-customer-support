#!/usr/bin/env bash
# One-off repair: recreate order_management.orders with proper column names.
#
# The Glue crawler had clobbered this table with generic col0..col8 columns
# (LazySimpleSerDe). This drops it and recreates it as an EXTERNAL table with the
# correct schema (OpenCSVSerde, header skipped) pointing at the same CSV data, so
# the Order Management agent's queries (customer_id, order_status, ...) resolve.
#
# Usage:
#   export STRUCT_BUCKET=<structured-data bucket name from the backend stack>
#   export RESULTS_BUCKET=<athena-results bucket name from the backend stack>
#   bash scripts/fix-orders-table.sh
#
# Both bucket names are CloudFormation outputs of the backend stack; they carry a
# per-deployment random suffix, so they must be supplied rather than hardcoded.
set -euo pipefail

if [[ -z "${STRUCT_BUCKET:-}" || -z "${RESULTS_BUCKET:-}" ]]; then
  echo "STRUCT_BUCKET and RESULTS_BUCKET must be set. See the usage notes at the top of this script." >&2
  exit 1
fi

RESULTS="s3://${RESULTS_BUCKET}/manual-orders-fix/"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

run_query() {
  local sql="$1"
  local qid
  qid=$(aws athena start-query-execution \
    --query-string "$sql" \
    --query-execution-context Database=order_management \
    --result-configuration "OutputLocation=$RESULTS" \
    --region "$REGION" \
    --query 'QueryExecutionId' --output text)
  echo "  started $qid"
  while true; do
    local state
    state=$(aws athena get-query-execution --query-execution-id "$qid" --region "$REGION" \
      --query 'QueryExecution.Status.State' --output text)
    case "$state" in
      SUCCEEDED) echo "  SUCCEEDED"; return 0 ;;
      FAILED|CANCELLED)
        local reason
        reason=$(aws athena get-query-execution --query-execution-id "$qid" --region "$REGION" \
          --query 'QueryExecution.Status.StateChangeReason' --output text)
        echo "  $state: $reason"; return 1 ;;
      *) sleep 1 ;;
    esac
  done
}

echo "1) Dropping existing orders table..."
run_query "DROP TABLE IF EXISTS order_management.orders"

echo "2) Creating orders table with proper columns..."
run_query "CREATE EXTERNAL TABLE order_management.orders (
  order_id STRING,
  customer_id STRING,
  product_id STRING,
  product_name STRING,
  order_status STRING,
  shipping_status STRING,
  return_exchange_status STRING,
  order_date STRING,
  delivery_date STRING
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
WITH SERDEPROPERTIES ('separatorChar' = ',', 'quoteChar' = '\"')
LOCATION 's3://${STRUCT_BUCKET}/order_management/orders/'
TBLPROPERTIES ('skip.header.line.count'='1', 'classification'='csv')"

echo "3) Verifying with a sample query..."
run_query "SELECT order_id, customer_id, order_status FROM order_management.orders LIMIT 3"

echo "Done. orders table repaired."
