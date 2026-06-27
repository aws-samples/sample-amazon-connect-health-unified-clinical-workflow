#!/usr/bin/env python3
"""
Load Synthea-generated FHIR resources into an AWS HealthLake datastore.

This script is an alternative to the `PreloadDataType=SYNTHEA` flag on
datastore creation. Use this when:
  - You created the datastore without preload data
  - You want to load your own Synthea-generated population
  - You want to refresh the datastore with new synthetic patients

Workflow:
  1. Generate FHIR-R4 bundles with Synthea (https://synthea.mitre.org/)
  2. Stage the .json or .ndjson files in an S3 bucket
  3. Run StartFHIRImportJob via this script
  4. Poll until the import completes

Usage:
    python3 load-sample-data.py \
        --datastore-id <id> \
        --jobs-bucket <s3-bucket> \
        --jobs-role-arn <iam-role-arn> \
        [--local-dir <path-to-synthea-output>] \
        [--s3-prefix import/synthea/] \
        [--region us-east-1]

Required parameters come from the shared-resources-stack outputs:
  HealthLakeDatastoreId, HealthLakeJobsBucketName, HealthLakeJobsRoleArn

Synthea data generation (for first-time users):
    git clone https://github.com/synthetichealth/synthea
    cd synthea
    ./run_synthea -p 10 Massachusetts  # generates 10 synthetic patients
    # Output appears in ./output/fhir/*.json
    # Pass that directory to --local-dir below
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import boto3

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)

POLL_INTERVAL_SECONDS = 30
POLL_TIMEOUT_SECONDS = 3600  # 1 hour — bulk imports can be slow


def parse_args():
    parser = argparse.ArgumentParser(
        description='Load Synthea FHIR data into an AWS HealthLake datastore.',
    )
    parser.add_argument(
        '--datastore-id', required=True,
        help='HealthLake datastore ID (from shared-resources-stack output '
             'HealthLakeDatastoreId)',
    )
    parser.add_argument(
        '--jobs-bucket', required=True,
        help='S3 bucket for import staging (from shared-resources-stack '
             'output HealthLakeJobsBucketName)',
    )
    parser.add_argument(
        '--jobs-role-arn', required=True,
        help='IAM role HealthLake assumes for the import job (from '
             'shared-resources-stack output HealthLakeJobsRoleArn)',
    )
    parser.add_argument(
        '--local-dir', default=None,
        help='Local directory containing Synthea-generated *.json or '
             '*.ndjson files. If omitted, the script assumes the data is '
             'already staged at s3://<jobs-bucket>/<s3-prefix>',
    )
    parser.add_argument(
        '--s3-prefix', default='import/synthea/',
        help='S3 key prefix under the jobs bucket where data is or will '
             'be staged (default: import/synthea/)',
    )
    parser.add_argument(
        '--region', default=os.environ.get('AWS_REGION', 'us-east-1'),
        help='AWS region (default: $AWS_REGION or us-east-1)',
    )
    parser.add_argument(
        '--skip-upload', action='store_true',
        help='Skip the S3 upload step (use when data is already in S3)',
    )
    parser.add_argument(
        '--no-poll', action='store_true',
        help='Start the import job and exit without waiting for completion',
    )
    parser.add_argument(
        '--job-name', default=None,
        help='Optional human-readable name for the import job',
    )
    return parser.parse_args()


def upload_directory_to_s3(local_dir, bucket, prefix, region):
    """Upload all .json and .ndjson files from local_dir to s3://bucket/prefix."""
    local_path = Path(local_dir)
    if not local_path.exists() or not local_path.is_dir():
        logger.error("Local directory not found: %s", local_dir)
        sys.exit(2)

    files = list(local_path.glob('*.json')) + list(local_path.glob('*.ndjson'))
    if not files:
        logger.error("No .json or .ndjson files found under %s", local_dir)
        sys.exit(2)

    s3 = boto3.client('s3', region_name=region)
    prefix = prefix.rstrip('/') + '/'
    logger.info("Uploading %d files to s3://%s/%s", len(files), bucket, prefix)
    for f in files:
        key = prefix + f.name
        s3.upload_file(str(f), bucket, key)
        logger.info("  uploaded: %s (%d bytes)", key, f.stat().st_size)
    logger.info("Upload complete.")


def start_import_job(datastore_id, jobs_bucket, jobs_role_arn, s3_prefix,
                     region, job_name):
    """Start a HealthLake bulk-import job and return the JobId."""
    client = boto3.client('healthlake', region_name=region)
    prefix = s3_prefix.rstrip('/') + '/'
    input_uri = f's3://{jobs_bucket}/{prefix}'
    job_name = job_name or f'synthea-load-{int(time.time())}'

    logger.info("Starting HealthLake import job:")
    logger.info("  datastore: %s", datastore_id)
    logger.info("  source:    %s", input_uri)
    logger.info("  role:      %s", jobs_role_arn)
    logger.info("  name:      %s", job_name)

    try:
        response = client.start_fhir_import_job(
            JobName=job_name,
            InputDataConfig={'S3Uri': input_uri},
            JobOutputDataConfig={
                'S3Configuration': {
                    'S3Uri': f's3://{jobs_bucket}/import-results/{job_name}/',
                    'KmsKeyId': 'AWS_OWNED_KMS_KEY',
                },
            },
            DatastoreId=datastore_id,
            DataAccessRoleArn=jobs_role_arn,
        )
    except client.exceptions.ClientError as e:
        logger.error("Failed to start import job: %s", e)
        sys.exit(3)

    job_id = response['JobId']
    logger.info("Import job started — JobId: %s", job_id)
    return job_id


def poll_until_complete(datastore_id, job_id, region):
    """Block until the import job completes. Return final job status."""
    client = boto3.client('healthlake', region_name=region)
    started_at = time.time()
    last_status = None

    while True:
        elapsed = int(time.time() - started_at)
        if elapsed > POLL_TIMEOUT_SECONDS:
            logger.error("Polling timed out after %d seconds.", elapsed)
            return None

        try:
            response = client.describe_fhir_import_job(
                DatastoreId=datastore_id,
                JobId=job_id,
            )
        except client.exceptions.ClientError as e:
            logger.warning("Describe call failed (will retry): %s", e)
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        properties = response.get('ImportJobProperties', {})
        status = properties.get('JobStatus', 'UNKNOWN')

        if status != last_status:
            logger.info("[%4ds] status=%s", elapsed, status)
            last_status = status

        if status in ('COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'):
            return properties

        time.sleep(POLL_INTERVAL_SECONDS)


def main():
    args = parse_args()

    if args.local_dir and not args.skip_upload:
        upload_directory_to_s3(
            args.local_dir, args.jobs_bucket, args.s3_prefix, args.region,
        )
    elif args.skip_upload:
        logger.info("Skipping upload (--skip-upload). Assuming data is at "
                    "s3://%s/%s", args.jobs_bucket, args.s3_prefix)
    else:
        logger.warning("No --local-dir provided and --skip-upload not set. "
                       "Assuming data is already at s3://%s/%s",
                       args.jobs_bucket, args.s3_prefix)

    job_id = start_import_job(
        args.datastore_id, args.jobs_bucket, args.jobs_role_arn,
        args.s3_prefix, args.region, args.job_name,
    )

    if args.no_poll:
        logger.info("--no-poll set, exiting. Track status with:")
        logger.info("  aws healthlake describe-fhir-import-job "
                    "--datastore-id %s --job-id %s", args.datastore_id, job_id)
        return 0

    final = poll_until_complete(args.datastore_id, job_id, args.region)
    if final is None:
        return 4

    status = final.get('JobStatus')
    if status == 'COMPLETED':
        logger.info("Import COMPLETED successfully.")
        return 0
    elif status == 'COMPLETED_WITH_ERRORS':
        logger.warning("Import completed WITH ERRORS. Check the job's "
                       "JobOutputDataConfig for the error log.")
        if 'Message' in final:
            logger.warning("Message: %s", final['Message'])
        return 5
    else:
        logger.error("Import FAILED: %s", final.get('Message', 'no message'))
        return 6


if __name__ == '__main__':
    sys.exit(main())
