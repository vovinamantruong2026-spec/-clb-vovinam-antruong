#!/usr/bin/env bash
set -euo pipefail
# Run manually by the Firebase project owner in Google Cloud Shell.
CLB_PROJECT='clb-vovinam-antruong-2026'
CLB_BUCKET='clb-vovinam-antruong-2026-backups'
CLB_SERVICE_ACCOUNT="weekly-clb-backup@${CLB_PROJECT}.iam.gserviceaccount.com"
if [[ "$(gcloud billing projects describe "$CLB_PROJECT" --format='value(billingEnabled)')" != 'True' ]]; then
  echo 'Cần chủ dự án bật Blaze/billing trước. Script không tự bật thanh toán.' >&2
  exit 1
fi
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com firestore.googleapis.com storage.googleapis.com identitytoolkit.googleapis.com --project "$CLB_PROJECT"
if ! gcloud iam service-accounts describe "$CLB_SERVICE_ACCOUNT" --project "$CLB_PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create weekly-clb-backup --display-name='CLB weekly private backups' --project "$CLB_PROJECT"
fi
if ! gcloud storage buckets describe "gs://${CLB_BUCKET}" --project "$CLB_PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${CLB_BUCKET}" --location=us-east1 --uniform-bucket-level-access --public-access-prevention --project "$CLB_PROJECT"
fi
# Enforce private access even if the dedicated bucket already existed.
gcloud storage buckets update "gs://${CLB_BUCKET}" --public-access-prevention --uniform-bucket-level-access --project "$CLB_PROJECT"
gcloud storage buckets add-iam-policy-binding "gs://${CLB_BUCKET}" --member="serviceAccount:${CLB_SERVICE_ACCOUNT}" --role=roles/storage.objectAdmin --project "$CLB_PROJECT"
for CLB_ROLE in roles/datastore.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$CLB_PROJECT" --member="serviceAccount:${CLB_SERVICE_ACCOUNT}" --role="$CLB_ROLE" --condition=None >/dev/null
done
npm --prefix functions ci --omit=dev
printf 'BACKUP_BUCKET=%s\n' "$CLB_BUCKET" > "functions/.env.${CLB_PROJECT}"
npx firebase-tools deploy --project "$CLB_PROJECT" --only functions:weeklyClubBackup,functions:cleanupClubBackups,functions:downloadWeeklyBackup,functions:cleanupClubTrash,functions:backupTrashAction,functions:studentFiles
echo 'Đã triển khai. Trong Cloud Scheduler, chạy Run now tác vụ weeklyClubBackup để kiểm tra bản đầu tiên. Chỉ coi lịch hoạt động khi bản sao và thời điểm thành công xuất hiện trên website.'
