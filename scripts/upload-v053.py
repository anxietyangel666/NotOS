import paramiko
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('163.5.16.156', port=22, username='root', password='nsJhCdGSRgX8Y', timeout=15)
sftp = ssh.open_sftp()

try:
    sftp.mkdir('/var/www/app/server/updates')
except IOError:
    pass

files_to_upload = ['NotOS-Update-0.5.3.zip', 'version.json']
local_dir = r'C:\NotOC\apps\server\updates'

for fname in files_to_upload:
    lpath = os.path.join(local_dir, fname)
    rpath = f'/var/www/app/server/updates/{fname}'
    print(f"Uploading {fname} ({os.path.getsize(lpath) / 1024 / 1024:.2f} MB)...", flush=True)
    sftp.put(lpath, rpath)
    print(f"Uploaded {fname} successfully!", flush=True)

sftp.close()
ssh.close()
print("All done!")
