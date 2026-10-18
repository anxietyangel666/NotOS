import os
import sys
import time
import subprocess
import paramiko

sys.stdout.reconfigure(encoding='utf-8')

HOST = '163.5.16.156'
PORT = 22
USER = 'root'
PASS = 'nsJhCdGSRgX8Y'
REMOTE_SERVER_DIR = '/var/www/app/server'

def run_local(cmd, cwd=None):
    print(f"[Local] {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, encoding='utf-8')
    if res.returncode != 0:
        print(f"[Error] {res.stderr}")
        raise RuntimeError(f"Command failed: {cmd}")
    return res.stdout

def sftp_upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except IOError:
        pass
    for item in os.listdir(local_dir):
        lpath = os.path.join(local_dir, item)
        rpath = f"{remote_dir}/{item}"
        if os.path.isdir(lpath):
            sftp_upload_dir(sftp, lpath, rpath)
        else:
            sftp.put(lpath, rpath)

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

    print("=== Step 1: Building client and publishing update bundle ===")
    run_local('npm.cmd run build --workspace=@notoc/client', cwd=root_dir)
    run_local('node scripts/publish-update.mjs', cwd=root_dir)

    print("\n=== Step 2: Connecting to VPS via SSH ===")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
    sftp = ssh.open_sftp()
    print(f"[SSH] Connected to {USER}@{HOST}:{PORT}")

    print("\n=== Step 3: Uploading server source code ===")
    local_server_src = os.path.join(root_dir, 'apps', 'server', 'src')
    remote_server_src = f"{REMOTE_SERVER_DIR}/src"
    sftp_upload_dir(sftp, local_server_src, remote_server_src)
    print(f"[SFTP] Synced {local_server_src} -> {remote_server_src}")

    print("\n=== Step 4: Uploading client update bundle, installer & manifest ===")
    local_updates = os.path.join(root_dir, 'apps', 'server', 'updates')
    remote_updates = f"{REMOTE_SERVER_DIR}/updates"
    try:
        sftp.mkdir(remote_updates)
    except IOError:
        pass

    def make_progress(fname):
        last_reported = [-20]
        def cb(transferred, total):
            pct = int(transferred / total * 100) if total else 0
            if pct >= last_reported[0] + 20 or transferred == total:
                last_reported[0] = pct
                print(f"  [{fname}] {pct}% ({transferred // 1048576} MB / {total // 1048576} MB)")
        return cb

    for fname in sorted(os.listdir(local_updates)):
        if fname.endswith('.zip') or fname == 'version.json' or fname.endswith('.exe'):
            lfile = os.path.join(local_updates, fname)
            rfile = f"{remote_updates}/{fname}"
            size = os.path.getsize(lfile)
            print(f"[SFTP] Uploading {fname} ({size // 1048576} MB)...")
            sftp.put(lfile, rfile, callback=make_progress(fname))
            print(f"[SFTP] Uploaded {fname} -> {rfile}")

    print("\n=== Step 5: Compiling server & restarting PM2 ===")
    build_cmd = f"cd {REMOTE_SERVER_DIR} && npm run build && pm2 restart notoc-server"
    stdin, stdout, stderr = ssh.exec_command(build_cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print(out)
    if err and 'error' in err.lower():
        print(f"[Remote Warning/Error] {err}")

    sftp.close()
    ssh.close()

    print("\n=== Step 6: Verifying remote health and update endpoints ===")
    time.sleep(2)
    verify_cmd = 'node -e "fetch(\'http://163.5.16.156:4000/api/client/update\').then(r=>r.json()).then(d=>console.log(\'Update API Response:\', d)).catch(console.error)"'
    verify_out = run_local(verify_cmd, cwd=root_dir)
    print(verify_out)

    print("\n[SUCCESS] Server and update deployment finished successfully!")
    print("Now all clients launching NotOS from their desktop will automatically receive this update.")

if __name__ == '__main__':
    main()
