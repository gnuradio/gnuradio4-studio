#!/usr/bin/env bash
# Copyright 2026 Marcus Müller
# This script is mostly for documentation.
#
# Prerequisites:
# - a Backblaze.com account, of which you hold a master or application key empowered to create buckets
# - uv (the python manager), to run the b2 utility (I don't plan on installing that on every machine)
# - gh (the github CLI client) https://github.com/cli/cli
#
#############
# CONSTANTS #
# the B2 program; you might want to want to invoke something else
B2="${B2:=uvx b2}"
# The gh program
GH="${GH:=gh}"
# The profile under which you're using the master key
B2_PROFILE="GNU Radio Master"
# The name of the bucket you want to create
BUCKET_NAME="gnuradio4-studio-public"
# Some info about the bucket. Currently not used by anything.
BUCKET_INFO="{\"description\": \"Public bucket for hosting nightlies and CI artifact instances of gr-studio\", \"creating_user\": \"$(whoami)\"}"
# Filename prefix
B2_FNAME_PREFIX_NIGHTLIES="nightly/"
B2_FNAME_PREFIX_COMMIT="commit/"
### Life times:
# Cancel unfinished uploads 2 days after start
B2_CANCEL_UPLOAD=2
# Fully delete hidden (i.e., overwritten/manually hidden) files after days:
B2_HIDDEN_TO_DELETED=1
# automatically delete uploaded files after days:
B2_UPLOAD_TO_DELETED_NIGHTLIES=365
B2_UPLOAD_TO_DELETED_COMMIT=60
# Suffixes etc
RW_SUFFIX="rw"
# Action secret / variable names
GHA_B2_BUCKET_NAME_NAME=PUB_BUCKET_NAME
GHA_B2_KEY_NAME=PUB_BUCKET_KEY
GHA_B2_KEY_ID_NAME=PUB_BUCKET_KEY_ID
#############
# AUTHORIZATION
# if you haven't yet, you'll have to authenticate with your master/app key
# ${B2} account authorize --profile "${B2_PROFILE}" "${KEYID}" "${KEY}"
######

(
  $B2 bucket create \
  --profile "${B2_PROFILE}" \
  --bucket-info "${BUCKET_INFO}" \
  --lifecycle-rule \
  "{\"daysFromHidingToDeleting\": ${B2_HIDDEN_TO_DELETED}, \"daysFromStartingToCancelingUnfinishedLargeFiles\": ${B2_CANCEL_UPLOAD}, \"daysFromUploadingToHiding\": ${B2_UPLOAD_TO_DELETED_NIGHTLIES}, \"fileNamePrefix\": \"${B2_FNAME_PREFIX_NIGHTLIES}\" }" \
  --lifecycle-rule \
  "{\"daysFromHidingToDeleting\": ${B2_HIDDEN_TO_DELETED}, \"daysFromStartingToCancelingUnfinishedLargeFiles\": ${B2_CANCEL_UPLOAD}, \"daysFromUploadingToHiding\": ${B2_UPLOAD_TO_DELETED_COMMIT}, \"fileNamePrefix\": \"${B2_FNAME_PREFIX_COMMIT}\" }" \
  "${BUCKET_NAME}" \
  allPublic \
  | tee -a "${BUCKET_NAME}.id" \
  && echo "created bucket ${BUCKET_NAME}"
) && (
  $B2 key create \
  --profile "${B2_PROFILE}" \
  --bucket "${BUCKET_NAME}" \
  "${BUCKET_NAME}-${RW_SUFFIX}" \
  "listAllBucketNames,listBuckets,readBuckets,listFiles,readFiles,shareFiles,writeFiles,deleteFiles,readBucketEncryption,readBucketLogging,readBucketReplications,readBucketNotifications,writeBucketNotifications" \
  | tee -a "${BUCKET_NAME}-${RW_SUFFIX}.key" \
  && echo "created RW key for ${BUCKET_NAME}"
) && (
  $GH variable set \
  "${GHA_B2_BUCKET_NAME_NAME}" \
  --body "${BUCKET_NAME}" \
  && echo "set variable: bucket name (${GHA_B2_BUCKET_NAME_NAME}) to ${BUCKET_NAME}"
) && (
  $GH variable set \
  "${GHA_B2_KEY_ID_NAME}" \
  --body "$(cut -f 1 -d " " "${BUCKET_NAME}-${RW_SUFFIX}.key")" \
  && echo "set variable: key ID (${GHA_B2_KEY_ID_NAME}) to $(cut -f 1 -d " " "${BUCKET_NAME}-${RW_SUFFIX}.key")"
) && (
  $GH secret set \
  "${GHA_B2_KEY_NAME}" \
  -a actions \
  --body "$(cut -f 2 -d " " "${BUCKET_NAME}-${RW_SUFFIX}.key")" \
  && echo "set secret: key"
)

